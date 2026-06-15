// Long-horizon investment analysis — fundamentals (Finnhub) + weekly-chart
// technicals + three AI investor personas (growth / value / skeptic) and a
// final verdict with an accumulation zone. Analysis only, never places a trade.

import { callAgent, callAgentJSON, aiEnabled } from "@/lib/anthropic";
import { fetchYahooCandlesSmart } from "@/lib/yahoo";
import { computeLongTermStats, type LongTermStats } from "./stats";
import { fetchFundamentals, fundamentalsLine, type Fundamentals } from "@/lib/market/fundamentals";

export type Stance = "buy" | "hold" | "avoid";
export type Verdict = "strong-buy" | "buy" | "watch" | "avoid";

export interface InvestorView {
  persona: "growth" | "value" | "skeptic";
  stance: Stance;
  confidence: number; // 0..1
  reason: string;
}

export interface InvestResult {
  symbol: string;
  price: number;
  stats: LongTermStats;
  fundamentals: Fundamentals;
  views: InvestorView[];
  verdict: {
    rating: Verdict;
    entryLow: number | null;
    entryHigh: number | null;
    horizon: string;
    thesis: string[];
    risks: string[];
  };
  costUsd: number;
}

const THAI = "Write every free-text field (reason, horizon, thesis, risks) in Thai. Keep tickers, numbers and financial abbreviations (P/E, ROE, MA) as-is.";

const PERSONAS: { persona: InvestorView["persona"]; system: string }[] = [
  { persona: "growth", system: `You are a long-term growth investor (think 3-5 year holding periods). You care about revenue/EPS growth, market position, and secular trends. Be concise and honest. ${THAI}` },
  { persona: "value", system: `You are a disciplined value investor. You care about valuation (P/E, P/B vs quality), balance sheet strength, margins, and margin of safety. Be concise and honest. ${THAI}` },
  { persona: "skeptic", system: `You are the devil's advocate on an investment committee. Your job is to find reasons NOT to buy: stretched valuation, deteriorating fundamentals, broken trend, hype. Be concise and honest — but concede when the case is genuinely strong. ${THAI}` },
];

const VIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stance: { type: "string", enum: ["buy", "hold", "avoid"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["stance", "confidence", "reason"],
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rating: { type: "string", enum: ["strong-buy", "buy", "watch", "avoid"] },
    entryLow: { type: "number" },
    entryHigh: { type: "number" },
    horizon: { type: "string" },
    thesis: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["rating", "horizon", "thesis", "risks"],
};

const fmt = (n: number | null, d = 1) => (n == null ? "n/a" : n.toFixed(d));

export async function analyzeLongTerm(symbol: string): Promise<InvestResult> {
  const chart = await fetchYahooCandlesSmart(symbol, "5y", "1wk");
  const stats = computeLongTermStats(chart.candles);
  const fundamentals = await fetchFundamentals(chart.symbol);

  const statsLine =
    `Price ${fmt(stats.price, 2)} · CAGR(5y) ${fmt(stats.cagrPct)}%/y · 52w change ${fmt(stats.change52wPct)}% · ` +
    `vs 40-week MA ${fmt(stats.priceVsSma40wPct)}% · drawdown from 5y high ${fmt(stats.drawdownFromHighPct)}% · ` +
    `52w range position ${fmt(stats.rangePos52wPct)}/100 · weekly RSI ${fmt(stats.rsiWeekly)}`;
  const fundLine = fundamentalsLine(fundamentals, chart.symbol);

  let views: InvestorView[];
  let verdict: InvestResult["verdict"];
  let cost = 0;

  if (aiEnabled()) {
    const prompt = `Long-term investment analysis of ${chart.symbol} (weekly chart, 5y).\n${statsLine}\n${fundLine}\nWould you buy and hold this for 1-5 years at the current price? JSON {stance: buy|hold|avoid, confidence: 0-1, reason: one or two sentences}.`;
    const results = await Promise.all(
      PERSONAS.map((p) =>
        callAgentJSON<{ stance: Stance; confidence: number; reason: string }>({
          tier: "sonnet", system: p.system, prompt, maxTokens: 300, jsonSchema: VIEW_SCHEMA,
        }).then((r) => ({ ...r, persona: p.persona })),
      ),
    );
    views = results.map((r) => ({ persona: r.persona, stance: r.data.stance, confidence: clamp01(r.data.confidence), reason: r.data.reason }));
    cost += results.reduce((a, r) => a + r.costUsd, 0);

    const v = await callAgentJSON<{
      rating: Verdict; entryLow?: number; entryHigh?: number; horizon: string; thesis: string[]; risks: string[];
    }>({
      tier: "opus",
      system:
        "You chair the investment committee. Synthesize the three analysts into a final long-term verdict. " +
        "Give an accumulation price zone (entryLow-entryHigh) near sensible technical/valuation levels, a holding horizon, " +
        `3-5 thesis bullets and 2-4 key risks. Be decisive and honest — 'watch' and 'avoid' are valid answers. ${THAI}`,
      prompt: `${chart.symbol}\n${statsLine}\n${fundLine}\nCommittee reads: ${views.map((x) => `${x.persona}=${x.stance}(${Math.round(x.confidence * 100)}%: ${x.reason})`).join("; ")}\nJSON {rating, entryLow, entryHigh, horizon, thesis, risks}.`,
      maxTokens: 700,
      jsonSchema: VERDICT_SCHEMA,
    });
    cost += v.costUsd;
    verdict = {
      rating: v.data.rating,
      entryLow: num(v.data.entryLow),
      entryHigh: num(v.data.entryHigh),
      horizon: v.data.horizon,
      thesis: (v.data.thesis ?? []).slice(0, 5),
      risks: (v.data.risks ?? []).slice(0, 4),
    };
  } else {
    views = mockViews(stats);
    verdict = mockVerdict(stats, views);
  }

  return { symbol: chart.symbol, price: stats.price, stats, fundamentals, views, verdict, costUsd: cost };
}

// ---- helpers ----
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- mock path (no AI backend) ----
function mockViews(s: LongTermStats): InvestorView[] {
  const aboveMa = (s.priceVsSma40wPct ?? 0) > 0;
  const growing = (s.cagrPct ?? 0) > 10;
  const cheapish = s.drawdownFromHighPct < -20;
  return [
    { persona: "growth", stance: growing && aboveMa ? "buy" : "hold", confidence: 0.6, reason: `CAGR ${fmt(s.cagrPct)}%/y, ${aboveMa ? "above" : "below"} 40w MA (mock)` },
    { persona: "value", stance: cheapish ? "buy" : "hold", confidence: 0.55, reason: `${fmt(s.drawdownFromHighPct)}% off the 5y high (mock)` },
    { persona: "skeptic", stance: aboveMa ? "hold" : "avoid", confidence: 0.5, reason: `weekly RSI ${fmt(s.rsiWeekly)} (mock)` },
  ];
}
function mockVerdict(s: LongTermStats, views: InvestorView[]): InvestResult["verdict"] {
  const buys = views.filter((v) => v.stance === "buy").length;
  const rating: Verdict = buys >= 2 ? "buy" : buys === 1 ? "watch" : "avoid";
  const ma = s.sma40w ?? s.price * 0.9;
  return {
    rating,
    entryLow: Math.min(ma, s.price) * 0.97,
    entryHigh: Math.min(ma * 1.03, s.price),
    horizon: "1-3 years (mock)",
    thesis: ["[mock] Enable an AI backend (API key or Claude Code CLI) for a real thesis."],
    risks: ["[mock] Mock verdict is rule-based, not researched."],
  };
}
