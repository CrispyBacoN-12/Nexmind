// The chart-agent orchestrator: 5-minute + daily bars in, at most five long
// sweep setups out, each with the AI's reading, and every setup found logged.
//
// Every I/O dependency is injected (same shape as scanAgent/runScanAgent.ts),
// so the whole flow is testable with stubs. Only the intraday bars are fatal:
// without them there is nothing to read. Daily bars (ATR), the AI and the log
// degrade on their own and never fail the run.
//
// Read-only: it finds and describes setups, it never places an order.

import { SIP_DELAY_MS } from "@/lib/alpaca";
import { atr, type Candle } from "@/lib/indicators";
import { etDate, marketPhase, sessionDates } from "@/lib/scanAgent/session";
import type { MarketPhase } from "@/lib/scanAgent/types";
import { splitSessions } from "./bars";
import { computeLevels } from "./levels";
import { toLogRows, type ChartSetupRow, type LogStatus } from "./logRows";
import type { Review, reviewSetups } from "./review";
import { findSetup } from "./setup";
import {
  CHART_AI_BARS,
  CHART_ATR_PERIOD,
  CHART_BAR_SECONDS,
  CHART_MAX_SETUPS,
  type Setup,
  type SessionSplit,
} from "./types";

export interface ChartDeps {
  now: () => number;
  /** Alpaca 5d/5m. A ticker with no data is absent from the map. */
  fetchIntraday: (tickers: string[]) => Promise<Map<string, Candle[]>>;
  /** Alpaca 1mo/1d. */
  fetchDaily: (tickers: string[]) => Promise<Map<string, Candle[]>>;
  review: typeof reviewSetups;
  log: (rows: ChartSetupRow[]) => Promise<void>;
  runId: () => string;
  /**
   * The request's signal. Once aborted (the page started a newer run or went
   * away) the run stops before the AI call and before the log, so a superseded
   * run spends nothing and writes nothing.
   */
  signal?: AbortSignal;
}

/** `bars` = previous + pre-market + regular 5-minute bars, for the chart. */
export interface ShownSetup {
  setup: Setup;
  review: Review;
  bars: Candle[];
}

export type ChartAgentResult =
  | {
      ok: true;
      ranAt: string;
      phase: MarketPhase;
      dataAsOf: string | null;
      shown: ShownSetup[];
      rejected: { ticker: string; review: Review }[];
      /** Setups that passed the AI but were cut by the CHART_MAX_SETUPS cap (logged as `capped`). */
      cappedCount: number;
      none: { ticker: string; reason: string }[];
      aiNote: string | null;
      logNote: string | null;
      backend: string;
    }
  | { ok: false; error: string };

const NO_INTRADAY = "ไม่มีข้อมูลแท่ง 5 นาที";
const NO_BARS_FOR_TICKER = "ไม่มีแท่งของตัวนี้";
const UNREAD_REASON = "AI ไม่ได้อ่าน";
/** A superseded or abandoned run: the page that asked is no longer waiting. */
const CANCELLED = "ยกเลิกแล้ว";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Daily ATR from finished days only: today's forming bar is dropped. NaN when it cannot be computed. */
function dailyAtr(daily: Candle[] | undefined, today: string): number {
  if (!daily) return NaN;
  const values = atr(
    daily.filter((c) => etDate(c.t) !== today),
    CHART_ATR_PERIOD,
  );
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null) return v;
  }
  return NaN;
}

export async function runChartAgent(
  rawTickers: string[],
  deps: ChartDeps,
): Promise<ChartAgentResult> {
  const nowMs = deps.now();
  const ranAt = new Date(nowMs).toISOString();
  const phase = marketPhase(nowMs);
  const tickers = [...new Set(rawTickers)];

  const base = { ok: true as const, ranAt, phase, dataAsOf: null, shown: [], rejected: [], cappedCount: 0, aiNote: null, logNote: null, backend: "none" };

  // 1. Outside the regular session there is nothing to read.
  if (phase !== "open") {
    const reason = phase === "pre" ? "ยังไม่มีแท่งในเวลาทำการ" : "ตลาดปิดแล้ว";
    return { ...base, none: tickers.map((ticker) => ({ ticker, reason })) };
  }

  // 2. Bars. Intraday is fatal; daily only costs the ATR.
  const { session: today } = sessionDates(nowMs);
  const dailyPromise = deps.fetchDaily(tickers).catch((e: unknown) => {
    console.warn("chart-agent: daily bars failed:", message(e));
    return new Map<string, Candle[]>();
  });
  let intraday: Map<string, Candle[]>;
  try {
    intraday = await deps.fetchIntraday(tickers);
  } catch (e) {
    console.warn("chart-agent: intraday fetch failed:", message(e));
    await dailyPromise;
    return { ok: false, error: NO_INTRADAY };
  }
  const daily = await dailyPromise;
  if (deps.signal?.aborted) return { ok: false, error: CANCELLED };
  if (!tickers.some((t) => (intraday.get(t)?.length ?? 0) > 0)) {
    return { ok: false, error: NO_INTRADAY };
  }

  // 3. Per ticker: sessions -> levels -> setup. Input order is kept. Alpaca's
  // end is now - SIP_DELAY_MS and not bar-aligned, so its newest bar can still
  // be forming: only bars that ended by that cutoff are read.
  const cutoffMs = nowMs - SIP_DELAY_MS;
  const none: { ticker: string; reason: string }[] = [];
  const found: { setup: Setup; split: SessionSplit }[] = [];
  let dataAsOfMs: number | null = null;
  for (const ticker of tickers) {
    const candles = intraday.get(ticker);
    if (!candles || candles.length === 0) {
      none.push({ ticker, reason: NO_BARS_FOR_TICKER });
      continue;
    }
    const finished = candles.filter((c) => (c.t + CHART_BAR_SECONDS) * 1000 <= cutoffMs);
    const split = splitSessions(finished, today);
    if (split.regular.length > 0) {
      const endMs = (split.regular[split.regular.length - 1].t + CHART_BAR_SECONDS) * 1000;
      if (dataAsOfMs === null || endMs > dataAsOfMs) dataAsOfMs = endMs;
    }
    const lv = computeLevels(split);
    if ("error" in lv) {
      none.push({ ticker, reason: lv.error });
      continue;
    }
    const outcome = findSetup(ticker, split, lv.levels, dailyAtr(daily.get(ticker), today));
    if (outcome.kind === "none") none.push({ ticker, reason: outcome.reason });
    else found.push({ setup: outcome.setup, split });
  }
  const dataAsOf = dataAsOfMs === null ? null : new Date(dataAsOfMs).toISOString();

  if (found.length === 0) return { ...base, dataAsOf, none };

  // 4. One AI call for all setups. It should never throw; if it does, the
  // setups still stand, unread.
  let reviews: Map<string, Review>;
  let backend: string;
  let aiNote: string | null;
  try {
    const r = await deps.review(
      found.map(({ setup, split }) => ({ setup, recent: split.regular.slice(-CHART_AI_BARS) })),
    );
    reviews = r.reviews;
    backend = r.backend;
    aiNote = r.note;
  } catch (e) {
    reviews = new Map();
    backend = "none";
    aiNote = `AI ใช้ไม่ได้: ${message(e)}`;
  }
  if (deps.signal?.aborted) return { ok: false, error: CANCELLED };

  // 5. Decide: kept/unread are eligible, the first CHART_MAX_SETUPS are shown.
  const shown: ShownSetup[] = [];
  const rejected: { ticker: string; review: Review }[] = [];
  const decided: { setup: Setup; review: Review; status: LogStatus }[] = [];
  for (const { setup, split } of found) {
    const review: Review =
      reviews.get(setup.ticker) ?? { status: "unread", reading: null, reason: UNREAD_REASON };
    if (review.status === "rejected" || review.status === "stripped") {
      rejected.push({ ticker: setup.ticker, review });
      decided.push({ setup, review, status: review.status === "rejected" ? "ai_rejected" : "guard_stripped" });
    } else if (shown.length < CHART_MAX_SETUPS) {
      shown.push({ setup, review, bars: [...split.previous, ...split.premarket, ...split.regular] });
      decided.push({ setup, review, status: "shown" });
    } else {
      decided.push({ setup, review, status: "capped" });
    }
  }

  // 6. Log every setup found. A failure here is a note, never a failed run.
  let logNote: string | null = null;
  try {
    await deps.log(toLogRows(deps.runId(), decided, backend));
  } catch (e) {
    logNote = `บันทึกลงฐานข้อมูลไม่ได้: ${message(e)}`;
  }

  const cappedCount = decided.filter((d) => d.status === "capped").length;
  return { ok: true, ranAt, phase, dataAsOf, shown, rejected, cappedCount, none, aiNote, logNote, backend };
}
