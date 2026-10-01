// The only module in src/lib/riskSentry/ that touches the network, Prisma, and
// the clock — mirrors readMarketGate's own injected-deps shape (src/lib/market/marketGate.ts)
// so it is testable without DATABASE_URL or a live provider.
// src/app/api/cron/risk-sentry/route.ts calls this with the real implementations.

import type { Candle } from "@/lib/indicators";
import type { EarningsInfo } from "@/lib/advisor/types";
import { gateSlots } from "@/lib/market/marketGate";
import { BENCHMARK } from "@/lib/market/regime";
import { earningsWatchdog, type EarningsWatchdogHit } from "./earningsWatchdog";
import { correlationAlert, type CorrelationAlertPair } from "./correlationAlert";
import { mergeHoldingSources } from "./holdings";
import { marketGateAlert, type MarketGateAlertResult, type GateReading } from "./marketGateAlert";

export const RISK_SENTRY_LAST_GATE_SETTING = "riskSentry:lastGate";

export interface RunRiskSentryDeps {
  getRiskSentryHoldings: () => Promise<string[]>;
  getJournalOpenTickers: () => Promise<string[]>;
  setRiskSentryHoldings: (tickers: string[]) => Promise<void>;
  fetchCandlesBatch: (symbols: string[], range: "2y", interval: "1d") => Promise<Map<string, { candles: Candle[] }>>;
  fetchCandles: (symbol: string, range: "2y", interval: "1d", minDays: number) => Promise<{ candles: Candle[] }>;
  fetchNextEarnings: (ticker: string) => Promise<EarningsInfo>;
  getSetting: (key: string, fallback: string) => Promise<string>;
  setSetting: (key: string, value: string) => Promise<void>;
}

export interface RunRiskSentrySummary {
  skipped: boolean;
  message: string | null;
  earnings: EarningsWatchdogHit[];
  gate: MarketGateAlertResult;
  correlations: CorrelationAlertPair[];
}

const GATE_READINGS: readonly GateReading[] = ["above", "below", "unknown"];

function composeMessage(
  earnings: EarningsWatchdogHit[],
  gate: MarketGateAlertResult,
  correlations: CorrelationAlertPair[],
): string | null {
  const sections: string[] = [];
  if (earnings.length > 0) {
    sections.push(
      "**Earnings this week**\n" +
        earnings.map((e) => `${e.ticker}: ${e.date}${e.hour ? ` (${e.hour})` : ""} — ${e.daysAway}d away`).join("\n"),
    );
  }
  if (gate.flipped) {
    sections.push(`**Market gate flipped**\n${gate.note}`);
  }
  if (correlations.length > 0) {
    sections.push(
      "**Correlated holdings**\n" +
        correlations.map((c) => `${c.a} / ${c.b}: ${c.correlation.toFixed(2)}`).join("\n"),
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : null;
}

export async function runRiskSentry(
  deps: RunRiskSentryDeps,
  today: Date = new Date(),
): Promise<RunRiskSentrySummary> {
  const [journalOpen, manual] = await Promise.all([deps.getJournalOpenTickers(), deps.getRiskSentryHoldings()]);
  const holdings = mergeHoldingSources(journalOpen, manual);
  if (holdings.length === 0) {
    return {
      skipped: true,
      message: null,
      earnings: [],
      gate: { flipped: false, from: "unknown", to: "unknown", note: "no holdings configured" },
      correlations: [],
    };
  }

  const [candleMap, benchmarkResp, earningsResults, lastReadingRaw] = await Promise.all([
    deps.fetchCandlesBatch(holdings, "2y", "1d"),
    deps.fetchCandles(BENCHMARK, "2y", "1d", 300),
    Promise.all(holdings.map(async (ticker) => ({ ticker, earnings: await deps.fetchNextEarnings(ticker) }))),
    deps.getSetting(RISK_SENTRY_LAST_GATE_SETTING, "unknown"),
  ]);

  const lastReading: GateReading = GATE_READINGS.includes(lastReadingRaw as GateReading)
    ? (lastReadingRaw as GateReading)
    : "unknown";

  const holdingCandles = holdings.map((ticker) => ({ ticker, candles: candleMap.get(ticker)?.candles ?? null }));

  const earningsHits = earningsWatchdog(earningsResults, today);
  const gateDecision = gateSlots(benchmarkResp.candles, 0);
  const gateResult = marketGateAlert(gateDecision, lastReading);
  const correlationHits = correlationAlert(holdingCandles);

  await deps.setSetting(RISK_SENTRY_LAST_GATE_SETTING, gateResult.to);

  return {
    skipped: false,
    message: composeMessage(earningsHits, gateResult, correlationHits),
    earnings: earningsHits,
    gate: gateResult,
    correlations: correlationHits,
  };
}
