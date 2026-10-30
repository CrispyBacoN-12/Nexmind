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
import { stopWatch, type StopWatchHit } from "./stopWatch";
import { marketGateAlert, type MarketGateAlertResult, type GateReading } from "./marketGateAlert";
import { filingWatch, filingWindowStart, type FilingFetchResult, type FilingWatchResult } from "./filingWatch";

export const RISK_SENTRY_LAST_GATE_SETTING = "riskSentry:lastGate";
/** The end of the last 8-K window that was fully checked, ISO UTC. */
export const RISK_SENTRY_FILINGS_CHECKED_TO_SETTING = "riskSentry:filingsCheckedTo";

export interface RunRiskSentryDeps {
  getRiskSentryHoldings: () => Promise<string[]>;
  getJournalOpenPositions: () => Promise<{ ticker: string; stop: number }[]>;
  setRiskSentryHoldings: (tickers: string[]) => Promise<void>;
  fetchCandlesBatch: (symbols: string[], range: "2y", interval: "1d") => Promise<Map<string, { candles: Candle[] }>>;
  fetchCandles: (symbol: string, range: "2y", interval: "1d", minDays: number) => Promise<{ candles: Candle[] }>;
  fetchNextEarnings: (ticker: string) => Promise<EarningsInfo>;
  /** Never rejects: a failed ticker comes back as `{ error }`. */
  fetchRecentFilings: (tickers: string[]) => Promise<Map<string, FilingFetchResult>>;
  getSetting: (key: string, fallback: string) => Promise<string>;
  setSetting: (key: string, value: string) => Promise<void>;
}

export interface RunRiskSentrySummary {
  skipped: boolean;
  message: string | null;
  stops: StopWatchHit[];
  earnings: EarningsWatchdogHit[];
  gate: MarketGateAlertResult;
  correlations: CorrelationAlertPair[];
  filings: FilingWatchResult;
  /** ISO UTC start of the 8-K window this run read. null when skipped. */
  filingsSince: string | null;
}

const NO_FILINGS: FilingWatchResult = { hits: [], failed: [], noFiler: [] };

/** EDGAR stamps UTC; the owner trades US hours, so the alert reads in New York time. */
function etTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(",", "") + " ET"
  );
}

const GATE_READINGS: readonly GateReading[] = ["above", "below", "unknown"];

function composeMessage(
  stops: StopWatchHit[],
  filings: FilingWatchResult,
  earnings: EarningsWatchdogHit[],
  gate: MarketGateAlertResult,
  correlations: CorrelationAlertPair[],
): string | null {
  const sections: string[] = [];
  if (stops.length > 0) {
    sections.push(
      "**Stop hit**\n" +
        stops
          .map((s) =>
            s.kind === "breached"
              ? `${s.ticker}: closed ${s.close.toFixed(2)} at/below stop ${s.stop.toFixed(2)} on ${s.date} — exit if no stop order is resting`
              : `${s.ticker}: low ${s.low.toFixed(2)} traded through stop ${s.stop.toFixed(2)} on ${s.date}, closed ${s.close.toFixed(2)} — check whether the stop filled`,
          )
          .join("\n"),
    );
  }
  // Right after stop hits: a restatement or an auditor change can matter more
  // than anything below it, and nothing scheduled would have warned about it.
  if (filings.hits.length > 0 || filings.failed.length > 0) {
    const lines = filings.hits.map(
      (h) =>
        `${h.ticker}${h.tier === "red" ? " — RED" : ""}: ${h.form} ${etTime(h.acceptedAt)} — ` +
        `${h.items.map((i) => `${i.code} ${i.label}`).join("; ")}\n${h.url}`,
    );
    if (filings.failed.length > 0) {
      lines.push(
        `NOT checked (EDGAR failed, read these yourself): ` +
          filings.failed.map((f) => `${f.ticker} (${f.reason})`).join(", "),
      );
    }
    sections.push("**SEC 8-K filings**\n" + lines.join("\n"));
  }
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
  const [journalOpen, manual] = await Promise.all([deps.getJournalOpenPositions(), deps.getRiskSentryHoldings()]);
  const holdings = mergeHoldingSources(
    journalOpen.map((p) => p.ticker),
    manual,
  );
  if (holdings.length === 0) {
    return {
      skipped: true,
      message: null,
      stops: [],
      earnings: [],
      gate: { flipped: false, from: "unknown", to: "unknown", note: "no holdings configured" },
      correlations: [],
      filings: NO_FILINGS,
      filingsSince: null,
    };
  }

  const [candleMap, benchmarkResp, earningsResults, lastReadingRaw, filingMap, filingsCheckedTo] = await Promise.all([
    deps.fetchCandlesBatch(holdings, "2y", "1d"),
    deps.fetchCandles(BENCHMARK, "2y", "1d", 300),
    Promise.all(holdings.map(async (ticker) => ({ ticker, earnings: await deps.fetchNextEarnings(ticker) }))),
    deps.getSetting(RISK_SENTRY_LAST_GATE_SETTING, "unknown"),
    deps.fetchRecentFilings(holdings),
    deps.getSetting(RISK_SENTRY_FILINGS_CHECKED_TO_SETTING, ""),
  ]);

  const lastReading: GateReading = GATE_READINGS.includes(lastReadingRaw as GateReading)
    ? (lastReadingRaw as GateReading)
    : "unknown";

  const holdingCandles = holdings.map((ticker) => ({ ticker, candles: candleMap.get(ticker)?.candles ?? null }));

  const stopHits = stopWatch(
    journalOpen.map((p) => ({ ticker: p.ticker.toUpperCase(), stop: p.stop })),
    new Map(holdingCandles.map((h) => [h.ticker, h.candles])),
  );
  const earningsHits = earningsWatchdog(earningsResults, today);
  const gateDecision = gateSlots(benchmarkResp.candles, 0);
  const gateResult = marketGateAlert(gateDecision, lastReading);
  const correlationHits = correlationAlert(holdingCandles);

  const filingsSince = filingWindowStart(filingsCheckedTo || null, today);
  const filingResult = filingWatch(
    holdings.map((ticker) => ({
      ticker,
      result: filingMap.get(ticker) ?? { error: "no result came back for this ticker" },
    })),
    filingsSince,
    today,
  );

  await deps.setSetting(RISK_SENTRY_LAST_GATE_SETTING, gateResult.to);
  // The window only advances when every name was read. One failed ticker holds
  // it where it was, so the next run re-reads the same days rather than losing
  // that ticker's filings; the names that did succeed may repeat once.
  if (filingResult.failed.length === 0) {
    await deps.setSetting(RISK_SENTRY_FILINGS_CHECKED_TO_SETTING, today.toISOString());
  }

  return {
    skipped: false,
    message: composeMessage(stopHits, filingResult, earningsHits, gateResult, correlationHits),
    stops: stopHits,
    earnings: earningsHits,
    gate: gateResult,
    correlations: correlationHits,
    filings: filingResult,
    filingsSince: filingsSince.toISOString(),
  };
}
