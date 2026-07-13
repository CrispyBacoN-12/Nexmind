// Executes AI-authored strategy code inside a locked-down vm context. This is
// the ONLY place research-strategy code ever runs — at proposal/backtest time
// and (after human approval) at live-scan time. It is never written to a .ts
// file and require()'d/import()'d into the real module graph.
//
// SAFETY CAVEAT (must stay explicit, not buried): Node's `vm` module is not a
// hard security boundary — Node's own docs say "do not use it to run
// untrusted code". The deny-list below is regex/string matching, so a
// deliberately obfuscated LLM output (e.g. `"const"+"ructor"`, bracket-
// notation property access) could bypass it. This is accepted here because
// the "adversary" is an LLM's occasional bad/naive output in a single-user
// local paper-trading app, not a malicious external actor. AST-based static
// analysis (acorn/esprima) is a real hardening option but out of scope for v1.

import * as vm from "node:vm";
import type { Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";

export interface SandboxSignal { side: "long" | "short"; note: string }
export interface CompiledStrategy {
  /** bars/snaps are the FULL history; invoke slices to [0, i] itself so AI code can never see beyond the current bar. */
  invoke(bars: Candle[], snaps: ScanSnapshot[], i: number): SandboxSignal | null;
}

export class SandboxSafetyError extends Error {
  constructor(public readonly matched: string[]) {
    super(`unsafe construct(s) detected: ${matched.join(", ")}`);
  }
}

const EXEC_TIMEOUT_MS = 150;

// Word-boundary matches on the raw source. Covers module/process/global
// access, network, prototype pollution, and anything that could be used to
// dodge the vm timeout via async/microtask scheduling (Promise/async/await
// keep the strategy function's own execution fully synchronous, which is all
// vm.Script's timeout can actually bound).
const DENY_PATTERNS: RegExp[] = [
  /\brequire\b/, /\bimport\b/, /\bprocess\b/, /\bglobal\b/, /\bglobalThis\b/,
  /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /__proto__/, /\bconstructor\b/,
  /\bFunction\b/, /\beval\b/, /\bchild_process\b/, /\bAtomics\b/, /\bSharedArrayBuffer\b/,
  /\bProxy\b/, /\bReflect\b/, /\bPromise\b/, /\basync\b/, /\bawait\b/,
  /\bsetTimeout\b/, /\bsetInterval\b/, /\bqueueMicrotask\b/,
];

export function scanForUnsafeConstructs(code: string): string[] {
  const matched: string[] = [];
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(code)) matched.push(pattern.source.replace(/\\b/g, ""));
  }
  return matched;
}

function normalizeSignal(result: unknown): SandboxSignal | null {
  if (result == null || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.side !== "long" && r.side !== "short") return null;
  return { side: r.side, note: typeof r.note === "string" ? r.note : "" };
}

/**
 * Compiles AI-authored strategy source ONCE. `code` must be a function body
 * (implicitly wrapped) that reads `bars`/`snaps` (arrays truncated so the
 * last element is the current bar) and returns `{ side, note } | null`.
 */
export function compileStrategy(code: string): CompiledStrategy {
  const unsafe = scanForUnsafeConstructs(code);
  if (unsafe.length) throw new SandboxSafetyError(unsafe);

  const context = vm.createContext({ Math });
  const defineScript = new vm.Script(`(function(bars, snaps) {\n${code}\n})`, {
    filename: "research-strategy.js",
  });
  const fn = defineScript.runInContext(context, { timeout: EXEC_TIMEOUT_MS });
  if (typeof fn !== "function") {
    throw new Error("strategy code must evaluate to a function");
  }
  context.__strategyFn = fn;
  // Pre-compiled once; each invocation only re-binds __bars/__snaps and re-runs
  // this tiny call script, so the timeout applies per-bar without re-parsing.
  const callScript = new vm.Script("__strategyFn(__bars, __snaps)", {
    filename: "research-strategy-call.js",
  });
  let frozen = false;

  return {
    invoke(bars, snaps, i) {
      if (i < 0 || i >= bars.length) return null;
      // Truncating with .slice() (not structuredClone) keeps this O(1)-ish per
      // bar instead of O(n) — a full backtest calls invoke() once per bar, so a
      // per-call deep clone makes the whole run O(n^2) and is unusable past a
      // few hundred bars (2000+ bars x up to 9 backtests took minutes). Instead,
      // freeze every bar/snapshot object once, on first invoke() for this
      // compiled strategy — mutating a frozen object silently no-ops rather
      // than corrupting state shared with other candidates, and slice() always
      // returns a fresh array, so pushes/pops on __bars/__snaps can't leak back.
      if (!frozen) {
        for (const b of bars) Object.freeze(b);
        for (const s of snaps) Object.freeze(s);
        frozen = true;
      }
      context.__bars = bars.slice(0, i + 1);
      context.__snaps = snaps.slice(0, i + 1);
      try {
        const result = callScript.runInContext(context, { timeout: EXEC_TIMEOUT_MS });
        return normalizeSignal(result);
      } catch {
        // Fail open on the SIGNAL (no trade this bar), never fail open on safety.
        return null;
      } finally {
        context.__bars = undefined;
        context.__snaps = undefined;
      }
    },
  };
}
