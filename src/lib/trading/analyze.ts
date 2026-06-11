// On-demand AI stock analysis — runs HAWK's 3 perspectives + a SAGE risk read on
// any symbol, WITHOUT placing a trade. Reuses the Scanner's indicator snapshot.

import { callAgent, callAgentJSON, aiEnabled } from "@/lib/anthropic";
import { scanSymbol, type ScanSnapshot } from "./scanner";
import { prisma } from "@/lib/db";
import { getFearGreed } from "@/lib/settings";

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
  views: PersonaView[];
  overall: { bias: View; confidence: number; summary: string };
  risk: { note: string; suggestedSl: number | null; suggestedTp: number | null };
  newsDigest: string;
  costUsd: number;
}

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
  const atr = s.atr ?? scan.price * 0.01;

  let views: PersonaView[];
  let summary: string;
  let risk: AnalysisResult["risk"];
  let cost = 0;

  if (aiEnabled()) {
    const prompt = `Analyze ${symbol}. ${snapshotLine(s)}.${newsDigest ? ` Intel: ${newsDigest}.` : ""}\nGive your read (bullish / bearish / neutral) with confidence 0-1 and one-sentence reason. JSON {view, confidence, reason}.`;
    const results = await Promise.all(
      PERSONAS.map((p) =>
        callAgentJSON<{ view: View; confidence: number; reason: string }>({
          tier: "sonnet", system: p.system, prompt, maxTokens: 250, jsonSchema: VIEW_SCHEMA,
        }).then((r) => ({ ...r, persona: p.persona })),
      ),
    );
    views = results.map((r) => ({ persona: r.persona, view: r.data.view, confidence: clamp01(r.data.confidence), reason: r.data.reason }));
    cost += results.reduce((a, r) => a + r.costUsd, 0);

    const summaryRes = await callAgent({
      tier: "sonnet",
      system: "You are HAWK, lead market analyst. Synthesize the team's reads into a clear 3-4 sentence verdict for a trader. No fluff.",
      prompt: `${symbol}. ${snapshotLine(s)}.\nAnalyst reads: ${views.map((v) => `${v.persona}=${v.view}(${v.reason})`).join("; ")}.${newsDigest ? ` Intel: ${newsDigest}.` : ""}\nWrite the verdict.`,
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
  } else {
    views = mockViews(s);
    summary = mockSummary(symbol, s, views);
    const bias = majority(views);
    risk = mockRisk(scan.price, atr, bias);
  }

  const bias = majority(views);
  const confidence = avg(views.filter((v) => v.view === bias).map((v) => v.confidence)) || avg(views.map((v) => v.confidence));

  return {
    symbol: scan.symbol, price: scan.price, snapshot: s, scannerNote: scan.note,
    views, overall: { bias, confidence, summary }, risk, newsDigest, costUsd: cost,
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
