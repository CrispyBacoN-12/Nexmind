// Single entry point for every AI agent call (HAWK, SAGE, Secretary, SCOUT).
// Centralizes model-tier selection, cost tracking, and JSON parsing so the
// rest of the app never touches the SDK directly.
//
// Backend resolution order:
//   1. ANTHROPIC_API_KEY set  → Anthropic SDK (pay per token)
//   2. Claude Code CLI found  → `claude -p` headless (subscription auth)
//   3. neither                → aiEnabled() false, callers use their mock paths
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

interface CliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

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
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(`claude -p --output-format json --model ${tier}`, {
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
        else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
      });
      child.stdin.write(fullPrompt);
      child.stdin.end();
    });

    const parsed = JSON.parse(raw) as CliResult;
    if (parsed.is_error || typeof parsed.result !== "string") {
      throw new Error(`claude CLI returned an error: ${raw.slice(0, 300)}`);
    }
    return {
      text: parsed.result,
      model: `cli:${tier}`,
      tier,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      // Subscription auth: the reported figure is informational, not billed.
      costUsd: 0,
    };
  } finally {
    cliRelease();
  }
}

/** True when AI calls are possible (API key or Claude Code CLI). */
export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || hasCli();
}

export interface AgentResult {
  text: string;
  model: string;
  tier: ModelTier;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CallOptions {
  tier?: ModelTier;
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** When set, constrains the response to this JSON schema (structured outputs). */
  jsonSchema?: Record<string, unknown>;
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

  const res = await client().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    ...(opts.jsonSchema
      ? { output_config: { format: { type: "json_schema", schema: opts.jsonSchema } } }
      : {}),
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;

  return {
    text,
    model,
    tier,
    inputTokens,
    outputTokens,
    costUsd: priceOf(tier, inputTokens, outputTokens),
  };
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
