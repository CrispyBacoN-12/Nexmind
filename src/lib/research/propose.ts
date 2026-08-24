// QUANT's AI calls: propose diverse strategy candidates, then refine one
// against its own backtest results. Mirrors the callAgentJSON pattern used by
// HAWK/SAGE/the Secretary (src/lib/anthropic.ts).

import { callAgentJSON, aiEnabled, aiBackend, type AiBackend } from "@/lib/anthropic";
import type { BacktestSummary } from "@/lib/backtest/engine";

export interface Candidate { label: string; code: string; rationale: string }

const STRATEGY_CODE_RULES = `
You are QUANT, writing entry logic for an algorithmic strategy sandbox.

Your "code" field is the BODY of a JavaScript function with this exact signature:
  function(bars, snaps) { ... your code ...; return { side: "long" | "short", note: "..." } or null; }

- \`bars\`: array of { t, o, h, l, c, v } candles, oldest first, truncated so the LAST element is the current bar.
- \`snaps\`: array of precomputed indicators aligned 1:1 with bars: { price, sma20, sma50, rsi, adx, plusDI, minusDI, macdHist, atr } (any field may be null early in the series).
- Return null when there is no fresh entry signal on the current (last) bar.
- Only use \`bars\`, \`snaps\`, and \`Math\`. Do NOT use: require, import, process, global, globalThis, fetch, XMLHttpRequest, WebSocket, Promise, async, await, setTimeout, setInterval, eval, Function, constructor, __proto__, Proxy, Reflect, child_process, Atomics, SharedArrayBuffer. Your code runs in a locked-down sandbox with a 150ms budget — no I/O, no network, no timers, synchronous only.
- Do not look ahead: only read the last element of bars/snaps (index bars.length - 1) and whatever history you need before it.
`.trim();

const CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          code: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["label", "code", "rationale"],
      },
    },
  },
  required: ["candidates"],
};

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    code: { type: "string" },
    note: { type: "string" },
  },
  required: ["code", "note"],
};

/**
 * Reports which backend produced the candidates alongside them.
 *
 * The mock fallback is indistinguishable downstream otherwise: runResearch used
 * to persist `Mock Momentum` / `Mock Mean-Reversion` / `Mock Breakout` as
 * ordinary ResearchStrategy rows with no record of what proposed them, and 34
 * of them reached `approved` — activatable on the live desk. A caller that must
 * refuse to bank a mock round has to be told, not left to pattern-match labels.
 */
export async function proposeCandidates(
  brief: string,
  symbol: string,
  interval: string,
): Promise<{ candidates: Candidate[]; costUsd: number; backend: AiBackend }> {
  const backend = aiBackend();
  if (!aiEnabled()) return { candidates: mockCandidates(brief), costUsd: 0, backend };

  const { data, costUsd } = await callAgentJSON<{ candidates: Candidate[] }>({
    tier: "sonnet",
    system: STRATEGY_CODE_RULES,
    prompt: `Research brief: "${brief}"\nSymbol: ${symbol}\nInterval: ${interval}\n\nPropose exactly 3 diverse strategy candidates that explore genuinely different angles — one momentum, one mean-reversion, one breakout. Each must satisfy the code contract above.`,
    jsonSchema: CANDIDATES_SCHEMA,
    maxTokens: 3000,
  });
  return { candidates: data.candidates, costUsd, backend };
}

export async function refineCandidate(
  code: string,
  summary: BacktestSummary,
): Promise<{ code: string; note: string; costUsd: number }> {
  if (!aiEnabled()) return { code, note: "mock refinement — unchanged", costUsd: 0 };

  const { data, costUsd } = await callAgentJSON<{ code: string; note: string }>({
    tier: "sonnet",
    system: STRATEGY_CODE_RULES,
    prompt: `Your previous strategy code:\n${code}\n\nBacktest result: ${JSON.stringify(summary)}\n\nCritique the result and revise the code to improve it (e.g. fewer losing trades, better expectancy). Keep the same overall angle. Return the full revised code body and a short note on what you changed.`,
    jsonSchema: REFINE_SCHEMA,
    maxTokens: 2000,
  });
  return { ...data, costUsd };
}

export async function fixUnsafeCode(
  code: string,
  flaggedConstructs: string[],
): Promise<{ code: string; costUsd: number }> {
  if (!aiEnabled()) return { code, costUsd: 0 };

  const { data, costUsd } = await callAgentJSON<{ code: string; note: string }>({
    tier: "sonnet",
    system: STRATEGY_CODE_RULES,
    prompt: `Your strategy code was rejected by the sandbox's safety scan for using: ${flaggedConstructs.join(", ")}.\n\nCode:\n${code}\n\nRewrite it to accomplish the same trading idea WITHOUT any of the flagged constructs. Return the full revised code body.`,
    jsonSchema: REFINE_SCHEMA,
    maxTokens: 2000,
  });
  return { code: data.code, costUsd };
}

/** Deterministic mock candidates — used when aiEnabled() is false. Exported so a
 *  cleanup pass can identify already-persisted mock rows by exact code match
 *  rather than by guessing from the "Mock " label prefix. */
export function mockCandidates(brief: string): Candidate[] {
  return [
    {
      label: "Mock Momentum",
      code: `
        var i = bars.length - 1;
        var s = snaps[i];
        if (s.rsi == null || s.adx == null) return null;
        if (s.adx > 25 && s.rsi > 55 && s.rsi < 70) return { side: "long", note: "mock momentum: RSI " + s.rsi.toFixed(0) };
        if (s.adx > 25 && s.rsi < 45 && s.rsi > 30) return { side: "short", note: "mock momentum: RSI " + s.rsi.toFixed(0) };
        return null;
      `.trim(),
      rationale: `Mock candidate for brief "${brief}" — trend-strength momentum entry (no AI key configured).`,
    },
    {
      label: "Mock Mean-Reversion",
      code: `
        var i = bars.length - 1;
        var s = snaps[i];
        if (s.rsi == null) return null;
        if (s.rsi < 30) return { side: "long", note: "mock mean-reversion: oversold RSI " + s.rsi.toFixed(0) };
        if (s.rsi > 70) return { side: "short", note: "mock mean-reversion: overbought RSI " + s.rsi.toFixed(0) };
        return null;
      `.trim(),
      rationale: `Mock candidate for brief "${brief}" — RSI extremes mean-reversion entry (no AI key configured).`,
    },
    {
      label: "Mock Breakout",
      code: `
        var i = bars.length - 1;
        if (i < 20) return null;
        var lookback = bars.slice(i - 20, i);
        var hi = Math.max.apply(null, lookback.map(function(b) { return b.h; }));
        var lo = Math.min.apply(null, lookback.map(function(b) { return b.l; }));
        var c = bars[i].c;
        if (c > hi) return { side: "long", note: "mock breakout: close above 20-bar high" };
        if (c < lo) return { side: "short", note: "mock breakout: close below 20-bar low" };
        return null;
      `.trim(),
      rationale: `Mock candidate for brief "${brief}" — 20-bar range breakout entry (no AI key configured).`,
    },
  ];
}
