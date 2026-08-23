// On-demand AI stock analysis — runs HAWK's 3 perspectives + a SAGE risk read on
// any symbol, WITHOUT placing a trade. Reuses the Scanner's indicator snapshot.

import { callAgent, callAgentJSON, aiBackend, aiOutageReason, type AiBackend } from "@/lib/anthropic";
import { scanSymbol, type ScanSnapshot } from "./scanner";
import { buildAnalystContext, personaLens, renderContext } from "./context";
import { fetchCandles } from "@/lib/marketData";
import { prisma } from "@/lib/db";
import { getFearGreed } from "@/lib/settings";
import { fetchFundamentals, fundamentalsLine, type Fundamentals } from "@/lib/market/fundamentals";

export type View = "bullish" | "bearish" | "neutral";

export interface PersonaView {
  persona: "trend" | "structure" | "counter";
  view: View;
  confidence: number; // 0..1
  reason: string;
}

export interface AnalysisResult {
  symbol: string;
  price: number;
  snapshot: ScanSnapshot;
  scannerNote: string;
  fundamentals: Fundamentals;
  views: PersonaView[];
  overall: { bias: View; confidence: number; summary: string };
  risk: { note: string; suggestedSl: number | null; suggestedTp: number | null };
  newsDigest: string;
  costUsd: number;
  /** Which backend produced `views`/`summary`/`risk`. "mock" means the numbers
   *  below are a deterministic stand-in, not an analyst's opinion — the UI must
   *  say so rather than presenting them as an AI read. */
  aiBackend: AiBackend;
  /** Set when aiBackend fell back to "mock": why AI could not answer. */
  aiNote?: string;
}

// Same three lenses HAWK votes with (see context.ts) — the Analyze button and
// the trading desk must not disagree because they were shown different sheets.
const PERSONAS: { persona: PersonaView["persona"]; system: string }[] = [
  { persona: "trend", system: "You are a trend-following analyst. Judge direction from MA alignment, ADX, +DI/-DI. Be concise." },
  { persona: "structure", system: "You are a market-structure analyst. Judge from swings, support/resistance, and whether price respects key levels. Be concise." },
  { persona: "counter", system: "You are a mean-reversion analyst. Look for exhaustion and overextension (RSI extremes). Be concise." },
];

const VIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    view: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["view", "confidence", "reason"],
};

const RISK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { note: { type: "string" }, sl: { type: "number" }, tp: { type: "number" } },
  required: ["note"],
};

const fmt = (n: number | null) => (n == null ? "n/a" : n.toFixed(2));

function snapshotLine(s: ScanSnapshot): string {
  return `Price ${fmt(s.price)} · SMA20 ${fmt(s.sma20)} · SMA50 ${fmt(s.sma50)} · RSI ${fmt(s.rsi)} · ADX ${fmt(s.adx)} · +DI ${fmt(s.plusDI)} · -DI ${fmt(s.minusDI)} · MACD ${fmt(s.macdHist)} · ATR ${fmt(s.atr)}`;
}

export async function analyzeSymbol(symbol: string): Promise<AnalysisResult> {
  const scan = await scanSymbol(symbol);
  const s = scan.snapshot;
  const newsDigest = await latestNewsDigest();
  const fundamentals = await fetchFundamentals(scan.symbol);
  const fundLine = fundamentalsLine(fundamentals, scan.symbol);
  const atr = s.atr ?? scan.price * 0.01;

  // Seeded with the deterministic read so every exit path has an answer; the AI
  // branch below overwrites all three when it succeeds.
  let views: PersonaView[] = mockViews(s);
  let summary: string = mockSummary(symbol, s, views);
  let risk: AnalysisResult["risk"] = mockRisk(scan.price, atr, majority(views));
  let cost = 0;

  // An unreachable or unauthenticated backend used to escape this function and
  // surface as a 500 from /api/analyze — a blank screen instead of the mock read
  // the rest of the app already knows how to render. Degrade instead, and report
  // which path produced the answer so it is never mistaken for an analyst call.
  let backend: AiBackend = aiBackend();
  let aiNote = backend === "mock" ? (aiOutageReason() ?? "no AI backend configured") : undefined;

  if (backend !== "mock") {
    try {
      const facts = renderContext(
        buildAnalystContext(scan, {
          newsDigest,
          fundamentals: fundLine,
          higherTf: await fetchCandles(scan.symbol, "1y", "1d").then((r) => r.candles).catch(() => null),
        }),
      );
      const task = "Give your read (bullish / bearish / neutral) with confidence 0-1 and a one-sentence reason citing the number that decided it. JSON {view, confidence, reason}.";
      const results = await Promise.all(
        PERSONAS.map((p) =>
          callAgentJSON<{ view: View; confidence: number; reason: string }>({
            tier: "sonnet", system: p.system, prompt: `${facts}\n\n${personaLens(p.persona)}\n\n${task}`,
            maxTokens: 250, jsonSchema: VIEW_SCHEMA,
          }).then((r) => ({ ...r, persona: p.persona })),
        ),
      );
      views = results.map((r) => ({ persona: r.persona, view: r.data.view, confidence: clamp01(r.data.confidence), reason: r.data.reason }));
      cost += results.reduce((a, r) => a + r.costUsd, 0);

      const summaryRes = await callAgent({
        tier: "sonnet",
        system: "You are HAWK, lead market analyst. Synthesize the team's reads into a clear 3-4 sentence verdict for a trader. No fluff.",
        prompt: `${symbol}. ${snapshotLine(s)}.\n${fundLine}\nAnalyst reads: ${views.map((v) => `${v.persona}=${v.view}(${v.reason})`).join("; ")}.${newsDigest ? ` Intel: ${newsDigest}.` : ""}\nWrite the verdict.`,
        maxTokens: 350,
      });
      summary = summaryRes.text;
      cost += summaryRes.costUsd;

      const riskRes = await callAgentJSON<{ note: string; sl?: number; tp?: number }>({
        tier: "opus",
        system: "You are SAGE, head of risk. Give a one-to-two sentence risk read for this symbol and a sensible protective stop and first target if someone took the majority-bias trade. JSON {note, sl, tp}.",
        prompt: `${symbol}. ${snapshotLine(s)}. Majority bias: ${majority(views)}. ATR ${fmt(atr)}.`,
        maxTokens: 300, jsonSchema: RISK_SCHEMA,
      });
      risk = { note: riskRes.data.note, suggestedSl: num(riskRes.data.sl), suggestedTp: num(riskRes.data.tp) };
      cost += riskRes.costUsd;
    } catch (e) {
      // Partial results are worse than none here: a real persona read paired
      // with a mock summary would read as one coherent AI opinion. Reset to the
      // full deterministic read and label it.
      backend = "mock";
      aiNote = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      views = mockViews(s);
      summary = mockSummary(symbol, s, views);
      risk = mockRisk(scan.price, atr, majority(views));
    }
  }

  const bias = majority(views);
  const confidence = avg(views.filter((v) => v.view === bias).map((v) => v.confidence)) || avg(views.map((v) => v.confidence));

  return {
    symbol: scan.symbol, price: scan.price, snapshot: s, scannerNote: scan.note, fundamentals,
    views, overall: { bias, confidence, summary }, risk, newsDigest, costUsd: cost,
    aiBackend: backend, ...(aiNote ? { aiNote } : {}),
  };
}

// ---- helpers ----
async function latestNewsDigest(): Promise<string> {
  try {
    const fg = await getFearGreed();
    const news = await prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 4 });
    const lines = news.map((n) => `${n.source}: ${n.title}`).join("; ");
    return fg ? `Fear & Greed: ${fg.value} (${fg.label}); ${lines}` : lines;
  } catch { return ""; }
}

function majority(views: PersonaView[]): View {
  const b = views.filter((v) => v.view === "bullish").length;
  const s = views.filter((v) => v.view === "bearish").length;
  if (b > s) return "bullish";
  if (s > b) return "bearish";
  return "neutral";
}
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- mock (no API key) ----
function mockViews(s: ScanSnapshot): PersonaView[] {
  const up = (s.sma20 ?? 0) > (s.sma50 ?? 0) && (s.plusDI ?? 0) >= (s.minusDI ?? 0);
  const rsi = s.rsi ?? 50;
  return [
    { persona: "trend", view: up ? "bullish" : "bearish", confidence: 0.6, reason: `MA ${up ? "stacked up" : "rolling over"}, ADX ${fmt(s.adx)} (mock)` },
    { persona: "structure", view: (s.price ?? 0) > (s.sma50 ?? 0) ? "bullish" : "bearish", confidence: 0.55, reason: `price ${(s.price ?? 0) > (s.sma50 ?? 0) ? "above" : "below"} 50MA (mock)` },
    { persona: "counter", view: rsi > 70 ? "bearish" : rsi < 30 ? "bullish" : "neutral", confidence: 0.5, reason: `RSI ${fmt(rsi)} (mock)` },
  ];
}
function mockSummary(symbol: string, s: ScanSnapshot, views: PersonaView[]): string {
  const bias = majority(views);
  return `[mock] ${symbol} reads ${bias}. Trend ${views[0].view}, structure ${views[1].view}, mean-reversion ${views[2].view}. RSI ${fmt(s.rsi)}, ADX ${fmt(s.adx)}. Add an ANTHROPIC_API_KEY for a real AI verdict.`;
}
function mockRisk(price: number, atr: number, bias: View): AnalysisResult["risk"] {
  if (bias === "neutral") return { note: "[mock] No clear edge — wait for a cleaner setup.", suggestedSl: null, suggestedTp: null };
  const long = bias === "bullish";
  return {
    note: `[mock] If trading the ${bias} bias, keep risk ~1.5×ATR.`,
    suggestedSl: long ? price - 1.5 * atr : price + 1.5 * atr,
    suggestedTp: long ? price + 2.5 * atr : price - 2.5 * atr,
  };
}
