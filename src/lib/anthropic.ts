// Single entry point for every AI agent call (HAWK, SAGE, Secretary, SCOUT).
// Centralizes model-tier selection, cost tracking, and JSON parsing so the
// rest of the app never touches the SDK directly.
//
// Backend resolution order:
//   1. ANTHROPIC_API_KEY set  → Anthropic SDK (pay per token)
//   2. Claude Code CLI found  → `claude -p` headless (subscription auth), run
//                               under CLI_ISOLATION so it is a one-shot
//                               completion and not a full agent session
//   3. neither                → aiEnabled() false, callers use their mock paths
//
// A backend that is present but cannot authenticate is treated as (3), not as a
// hard error: one fatal failure latches the backend down (see backendFailure)
// so the desk keeps trading on its rule-only mock path instead of 500ing, and
// aiBackend() reports the truth so trades can be labelled with what decided them.
//
// CLAUDE_CODE_OAUTH_TOKEN (optional): a token from `claude setup-token`, for
// ephemeral runners (e.g. GitHub Actions) that have no persisted `claude
// login` session. Injected as ANTHROPIC_API_KEY into the *spawned CLI child
// only* — never into this process's own env — so the resolution order above
// still picks path 2 (CLI) instead of misrouting to path 1 (direct SDK,
// which would reject a setup-token value as an invalid API key).

import Anthropic from "@anthropic-ai/sdk";
import { spawn, spawnSync } from "node:child_process";

export type ModelTier = "haiku" | "sonnet" | "opus";

// Authoritative model IDs + pricing (USD per 1M tokens) — see claude-api skill.
const MODELS: Record<ModelTier, { id: string; inPerM: number; outPerM: number }> = {
  haiku: { id: "claude-haiku-4-5", inPerM: 1.0, outPerM: 5.0 },
  sonnet: { id: "claude-sonnet-4-6", inPerM: 3.0, outPerM: 15.0 },
  opus: { id: "claude-opus-4-8", inPerM: 5.0, outPerM: 25.0 },
};

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to .env to enable AI agents.");
  }
  cached ??= new Anthropic();
  return cached;
}

// --- Claude Code CLI backend (subscription auth — no API key needed) ---

let cliDetected: boolean | null = null;
/** Detect the Claude Code CLI once per process. */
function hasCli(): boolean {
  if (cliDetected == null) {
    try {
      const r = spawnSync("claude --version", { shell: true, timeout: 15_000, encoding: "utf8" });
      cliDetected = r.status === 0;
    } catch {
      cliDetected = false;
    }
  }
  return cliDetected;
}

// hasCli() proves the binary exists, not that it can authenticate. A CLI whose
// `claude login` session has expired answers --version happily and then fails
// every real call — which made aiEnabled() claim the desk had AI while HAWK and
// SAGE threw, surfacing as a 500 instead of the mock fallback the rest of the
// app is built around. Latch a fatal backend failure so later calls take the
// mock path straight away, and let it lapse so a fresh `claude login` heals the
// desk without a restart.
const CLI_RETRY_AFTER_MS = 5 * 60_000;
let backendDown: { reason: string; at: number } | null = null;

/** Messages that mean the backend is unusable until a human fixes it — as
 *  opposed to a timeout or a one-off upstream blip, which is worth retrying.
 *
 *  The two spend patterns were added on 2026-08-30, after the CLI answered a
 *  research round with "You've hit your monthly spend limit". That matched none
 *  of the others, so nothing latched: the desk went on calling a backend that
 *  could not answer, every call failed, and War Room kept reporting AI online.
 *  A budget that has run out is exactly the case this latch exists for — it
 *  needs a human, and no amount of retrying will change it.
 *
 *  `limit` alone is deliberately not matched: a plain rate limit IS worth
 *  retrying, and latching it would take the desk off AI for five minutes over
 *  a hiccup — the opposite mistake, and just as wrong. */
const FATAL_BACKEND =
  /authenticat|oauth|logged.?in|api key|credit balance|quota|subscription|spend limit|usage limit/i;

/** Does this failure need a human before the backend can work again? */
export function isFatalBackendReason(reason: string): boolean {
  return FATAL_BACKEND.test(reason);
}

function backendUsable(): boolean {
  if (!backendDown) return true;
  if (Date.now() - backendDown.at < CLI_RETRY_AFTER_MS) return false;
  backendDown = null; // window lapsed — let the next call re-prove it
  return true;
}

/** Thrown when the configured backend cannot serve a call at all. Callers are
 *  expected to fall back to their mock path rather than fail the request. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

// The in-memory latch only covers one module instance: Next gives the RSC page
// graph and the route handlers their own copies, and on Vercel every serverless
// invocation starts clean. So it is mirrored to a Setting row — otherwise the
// War Room can render "AI online" while every trade tick is quietly falling
// back to the mock, which is exactly the blind spot this whole change exists to
// close. Written only on transitions, never on the hot path of a working call.
const OUTAGE_KEY = "ai:outage";
let persistedOutage: string | null | undefined;

// db.ts is imported lazily on both paths that touch it: this module sits on the
// import graph of pure-logic units whose tests run with no DATABASE_URL, and
// db.ts throws at module load without one.
function persistOutage(reason: string | null): void {
  if (persistedOutage === reason) return;
  persistedOutage = reason;
  const value = reason ? JSON.stringify({ reason, at: Date.now() }) : null;
  // Fire-and-forget: failing to record an outage must not also fail the call
  // that discovered it.
  void (async () => {
    const { prisma } = await import("@/lib/db");
    if (value) {
      await prisma.setting.upsert({ where: { key: OUTAGE_KEY }, create: { key: OUTAGE_KEY, value }, update: { value } });
    } else {
      await prisma.setting.deleteMany({ where: { key: OUTAGE_KEY } });
    }
  })().catch(() => {});
}

// Same lazy-import, fire-and-forget shape as persistOutage above, for the same
// reason: this module sits on the import graph of pure-logic units whose tests
// run with no DATABASE_URL. Losing a telemetry row must never fail the call it
// was measuring — an unwritable ledger is a worse outcome than a missing row,
// but a failed trade decision is worse than both.
function recordAiCall(
  backend: AiBackend,
  label: string | undefined,
  durationMs: number,
  r: Omit<AgentResult, "text" | "model" | "resolvedModel">,
): void {
  void (async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.aiCall.create({
      data: {
        label: label ?? null,
        tier: r.tier,
        backend,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheCreateTokens: r.cacheCreateTokens,
        cacheReadTokens: r.cacheReadTokens,
        costUsd: r.costUsd,
        reportedCostUsd: r.reportedCostUsd,
        durationMs,
      },
    });
  })().catch(() => {});
}

/** Classify a backend failure: latch the fatal ones, pass the rest through. */
function backendFailure(detail: string, source: "cli" | "api"): Error {
  const label = source === "cli" ? "claude CLI" : "anthropic api";
  const reason = detail.trim().slice(0, 200) || `unknown ${label} failure`;
  if (isFatalBackendReason(reason)) {
    backendDown = { reason: `${label} — ${reason}`, at: Date.now() };
    persistOutage(backendDown.reason);
    return new AiUnavailableError(reason);
  }
  return new Error(`${label}: ${reason}`);
}

/** How long a recorded outage stays on screen. The latch itself lapses after 5
 *  minutes so the next call re-proves the backend; the banner outlives it so a
 *  desk nobody has poked in an hour still shows that its last call failed. */
const OUTAGE_SHOW_FOR_MS = 6 * 60 * 60_000;

/** Outage state that survives process boundaries — for server components. */
export async function aiOutageStatus(): Promise<{ reason: string; ageMs: number } | null> {
  const local = aiOutageReason();
  if (local) return { reason: local, ageMs: backendDown ? Date.now() - backendDown.at : 0 };
  const row = await import("@/lib/db")
    .then(({ prisma }) => prisma.setting.findUnique({ where: { key: OUTAGE_KEY } }))
    .catch(() => null);
  if (!row) return null;
  try {
    const { reason, at } = JSON.parse(row.value) as { reason: string; at: number };
    const ageMs = Date.now() - at;
    return ageMs < OUTAGE_SHOW_FOR_MS ? { reason, ageMs } : null;
  } catch {
    return null;
  }
}

/** The CLI answers `--output-format json`; on failure the human-readable cause
 *  is in `.result`, not stderr (which is usually empty). */
function cliErrorText(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as CliResult;
    if (typeof parsed.result === "string") return parsed.result;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return stdout.slice(0, 300);
}

// Soft cap on concurrent CLI processes — protects subscription quota and CPU
// when a universe scan finds many setups at once (HAWK fires 3 calls per setup).
const CLI_CONCURRENCY = 3;
let cliActive = 0;
const cliWaiters: (() => void)[] = [];
async function cliAcquire(): Promise<void> {
  if (cliActive >= CLI_CONCURRENCY) await new Promise<void>((r) => cliWaiters.push(r));
  cliActive++;
}
function cliRelease(): void {
  cliActive--;
  cliWaiters.shift()?.();
}

/**
 * The resolved model id of a CLI result, or null. `modelUsage` can also list an
 * auxiliary model the CLI called on the side, sometimes first, so the key with the most
 * `outputTokens` wins; then the highest `costUSD`; then the first key.
 */
export function cliResolvedModel(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const usage = (parsed as { modelUsage?: unknown }).modelUsage;
  if (typeof usage !== "object" || usage === null) return null;
  const entries = Object.entries(usage as Record<string, unknown>);
  if (entries.length === 0) return null;
  const num = (v: unknown, field: string): number => {
    const x = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[field] : undefined;
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };
  const best = (field: string): string | null => {
    let key: string | null = null;
    let max = 0;
    for (const [k, v] of entries) {
      const x = num(v, field);
      if (x > max) [key, max] = [k, x];
    }
    return key;
  };
  return best("outputTokens") ?? best("costUSD") ?? entries[0][0];
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  /** Keyed by the resolved model id the call actually ran on. */
  modelUsage?: Record<string, unknown>;
  // The two cache fields carry ~99.9% of the real input on this path — a probe
  // measuring 8,029 total input tokens reports input_tokens: 2. Leaving them
  // off the type meant every CLI call was recorded as costing nothing.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * The flags that make `claude -p` a one-shot text completion instead of a full
 * Claude Code session. Measured, not guessed — see the numbers below.
 *
 * A bare `claude -p` boots the whole interactive agent in whatever directory
 * the Next server happens to be running from, which here is the repo root. Every
 * call therefore paid for the entire IDE context before it read a single number
 * off the card. Measured from the CLI's own session transcripts (four RAVEN runs
 * on 2026-09-12/13), the fixed prefix was **~105,000 tokens of cache-creation per
 * call**, and the largest single item in it was `CLAUDE.md` pulling in
 * `@docs/STATE.md` — 95 KB of handoff notes, injected in front of a prompt whose
 * real payload is ~900 tokens. Total input ran **163k-413k tokens per critique**
 * over 2-5 turns, because nothing stopped the agent from calling ToolSearch, Bash
 * and WebSearch first and re-sending the prefix on each turn.
 *
 * On subscription auth that is billed against the 5-hour usage window, so one
 * card could take a double-digit percentage of it. Same probe with these flags:
 * **6,579 input tokens, 1 turn, 13s** — a 25-63x reduction with the answer
 * unchanged (it still quotes the card's numbers, still returns the JSON).
 *
 *   --safe-mode   disables CLAUDE.md (and so STATE.md), skills, plugins, hooks,
 *                 MCP servers, custom agents and commands. Auth, model selection
 *                 and permissions are untouched, which is why this is the right
 *                 flag here and `--bare` is not: --bare forces ANTHROPIC_API_KEY
 *                 and would break the subscription path this function exists for.
 *   --tools ""    drops every built-in tool schema from the system prompt AND
 *                 makes a tool-calling loop impossible, so a turn is a turn. None
 *                 of these agents wants a tool; they all want one JSON object.
 *   --no-session-persistence
 *                 stops writing a ~400 KB transcript per call. 921 of them had
 *                 accumulated under ~/.claude/projects for this repo alone.
 *
 * Deliberately NOT added: --strict-mcp-config and --disable-slash-commands are
 * both already implied by --safe-mode, and the probe above confirms it (3.3k of
 * cache-creation total leaves no room for MCP schemas).
 */
const CLI_ISOLATION = '--safe-mode --tools "" --no-session-persistence';

/** One agent turn through `claude -p` headless mode. Prompt goes via stdin. */
async function callAgentCli(opts: CallOptions): Promise<AgentResult> {
  const tier = opts.tier ?? "sonnet";
  const fullPrompt = [
    opts.system ? `${opts.system}\n` : "",
    opts.prompt,
    opts.jsonSchema
      ? `\n\nRespond with ONLY a single JSON value matching this schema (no prose, no code fences):\n${JSON.stringify(opts.jsonSchema)}`
      : "",
  ].join("");

  await cliAcquire();
  const startedAt = Date.now();
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(`claude -p --output-format json --model ${tier} ${CLI_ISOLATION}`, {
        shell: true,
        windowsHide: true,
        env: process.env.CLAUDE_CODE_OAUTH_TOKEN
          ? { ...process.env, ANTHROPIC_API_KEY: process.env.CLAUDE_CODE_OAUTH_TOKEN }
          : process.env,
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude CLI timed out after 240s (${tier})`));
      }, 240_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        // stderr is usually empty on a failed run — the cause is in the JSON on stdout.
        else reject(backendFailure(err.trim() || cliErrorText(out) || `exited ${code}`, "cli"));
      });
      child.stdin.write(fullPrompt);
      child.stdin.end();
    });

    const parsed = JSON.parse(raw) as CliResult;
    if (parsed.is_error || typeof parsed.result !== "string") {
      throw backendFailure(cliErrorText(raw), "cli");
    }
    persistOutage(null); // the backend just proved itself — clear any stale banner
    const accounting = {
      tier,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheCreateTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      // Subscription auth: the reported figure is informational, not billed.
      costUsd: 0,
      reportedCostUsd: parsed.total_cost_usd ?? 0,
    };
    recordAiCall("cli", opts.label, Date.now() - startedAt, accounting);
    return { text: parsed.result, model: `cli:${tier}`, resolvedModel: cliResolvedModel(parsed), ...accounting };
  } finally {
    cliRelease();
  }
}

/** Which backend a call made right now would actually use. `"mock"` means the
 *  caller must take its deterministic fallback path — either nothing is
 *  configured, or the CLI is latched down after a fatal failure. */
export type AiBackend = "api" | "cli" | "mock";

export function aiBackend(): AiBackend {
  if (!backendUsable()) return "mock";
  if (process.env.ANTHROPIC_API_KEY) return "api";
  return hasCli() ? "cli" : "mock";
}

/** True when AI calls are possible (API key, or a Claude Code CLI that has not
 *  just failed fatally). A `true` here is not a promise the call will succeed —
 *  callers must still catch AiUnavailableError and fall back. */
export function aiEnabled(): boolean {
  return aiBackend() !== "mock";
}

/** Why AI is currently unavailable, for logs and the War Room banner. */
export function aiOutageReason(): string | null {
  if (!backendUsable()) return backendDown!.reason;
  if (process.env.ANTHROPIC_API_KEY || hasCli()) return null;
  return "no ANTHROPIC_API_KEY and no Claude Code CLI on PATH";
}

export interface AgentResult {
  text: string;
  model: string;
  /** The model id the backend says actually served the call (the CLI's
   *  `modelUsage` key, the API response's `model`); null when it did not say. */
  resolvedModel: string | null;
  tier: ModelTier;
  /** Money actually billed. Always 0 on the CLI path — subscription auth draws
   *  on the plan quota, not a card. Use `reportedCostUsd` for quota burn. */
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  /** What the backend says the call was worth at list price. Equal to costUsd
   *  on the API path; the CLI's own `total_cost_usd` on the CLI path. */
  reportedCostUsd: number;
}

export interface CallOptions {
  tier?: ModelTier;
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** When set, constrains the response to this JSON schema (structured outputs). */
  jsonSchema?: Record<string, unknown>;
  /** Who is calling — "hawk", "sage", "raven", … Recorded on the AiCall row so
   *  spend can be attributed to an agent instead of to the desk as a whole.
   *  Affects accounting only; never reaches the model. */
  label?: string;
}

function priceOf(tier: ModelTier, inTok: number, outTok: number): number {
  const m = MODELS[tier];
  return (inTok / 1_000_000) * m.inPerM + (outTok / 1_000_000) * m.outPerM;
}

/** One agent turn. Returns the text plus token/cost accounting. */
export async function callAgent(opts: CallOptions): Promise<AgentResult> {
  if (!process.env.ANTHROPIC_API_KEY && hasCli()) return callAgentCli(opts);

  const tier = opts.tier ?? "sonnet";
  const model = MODELS[tier].id;
  const startedAt = Date.now();

  let res: Anthropic.Message;
  try {
    res = await client().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      ...(opts.jsonSchema
        ? { output_config: { format: { type: "json_schema", schema: opts.jsonSchema } } }
        : {}),
    });
  } catch (e) {
    // A bad or exhausted key fails identically on every call — latch it rather
    // than let a universe scan burn one doomed request per symbol.
    throw backendFailure(e instanceof Error ? e.message : String(e), "api");
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  persistOutage(null); // the backend just proved itself — clear any stale banner

  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;

  // priceOf covers fresh input and output only. Cache creation and reads bill
  // at their own multiples of the input rate, so costUsd is a floor whenever
  // those columns are non-zero — the row keeps them separate so the gap stays
  // visible instead of being quietly averaged in at the wrong rate.
  const accounting = {
    tier,
    inputTokens,
    outputTokens,
    cacheCreateTokens: res.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    costUsd: priceOf(tier, inputTokens, outputTokens),
    reportedCostUsd: priceOf(tier, inputTokens, outputTokens),
  };
  recordAiCall("api", opts.label, Date.now() - startedAt, accounting);

  return { text, model, resolvedModel: res.model ?? null, ...accounting };
}

/** Call an agent and parse its JSON response. Tolerates stray prose/code fences. */
export async function callAgentJSON<T>(opts: CallOptions): Promise<{ data: T } & AgentResult> {
  const result = await callAgent(opts);
  const data = parseJsonLoose<T>(result.text);
  return { data, ...result };
}

/** Extract the first JSON object/array from a model response. */
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Strip ```json fences or surrounding prose, then grab the outermost braces.
    const fenced = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(fenced) as T;
    } catch {
      const start = fenced.search(/[[{]/);
      const end = Math.max(fenced.lastIndexOf("}"), fenced.lastIndexOf("]"));
      if (start !== -1 && end > start) {
        return JSON.parse(fenced.slice(start, end + 1)) as T;
      }
      throw new Error(`Agent did not return valid JSON: ${text.slice(0, 200)}`);
    }
  }
}
