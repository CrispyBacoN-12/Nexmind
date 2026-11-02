// The one-off replay of the chart agent's long-sweep rule (spec §7): over every
// session of the period, rank the universe as the live scan would have at 10:30 ET,
// run the LIVE splitSessions -> computeLevels -> findSetup pipeline on the top
// CHART_TOP_N, and score every setup as if it had been bought, against the random
// control. No AI, no cap: every setup counts.
//
// All I/O is injected (bars come from the caller's loaders) and only one ticker's
// bars are in memory at a time. Imports control.ts, which reaches prisma through
// research/control.ts, so a test of this module loads dotenv first.

import { SIP_DELAY_MS } from "@/lib/alpaca";
import type { Candle } from "@/lib/indicators";
import { etSessionCloseMs } from "@/lib/scanAgent/session";
import type { TvRow } from "@/lib/scanAgent/types";
import { splitSessions } from "@/lib/chartAgent/bars";
import { computeLevels } from "@/lib/chartAgent/levels";
import { findSetup } from "@/lib/chartAgent/setup";
import { CHART_BAR_SECONDS, CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { controlDistribution, type ControlTrade } from "./control";
import { summarize, beatsControl, type GroupStats } from "./groups";
import {
  indexDaily,
  indexIntraday,
  lowerBound,
  pickTopN,
  replayDailyAtr,
  replayRowFromIndex,
  type IntradayIndex,
} from "./replayRank";
import { scoreSetup } from "./score";
import {
  SCORECARD_MAX_HOLD_SESSIONS,
  SCORECARD_RUN_ET_MINUTES,
  type ExitVariant,
  type Outcome,
} from "./types";

/** Stated with every replay result; the page and the results doc show them. */
export const REPLAY_BIASES: string[] = [
  "รายชื่อหุ้นเป็น S&P 500 ปัจจุบัน — หุ้นที่เคยหลุดออกจากดัชนีไม่อยู่ในผล (survivorship bias)",
  "ไม่มีข้อมูลงบและ 8-K ย้อนหลัง — คะแนนส่วนนั้นนับเป็น 0",
];

/**
 * Prior sessions handed to splitSessions with today's bars. The live agent fetches
 * "5d"; splitSessions only uses the latest earlier session, so any window that
 * holds it gives the same split.
 */
const PRIOR_SESSIONS_FOR_SPLIT = 5;
const CLOSE_MIN = 960; // 16:00 ET

export interface ReplayDeps {
  /** ET dates (YYYY-MM-DD) of the period's sessions. */
  sessions: string[];
  universe: string[];
  /** All of a ticker's 5-minute bars (the period plus enough before it); [] when none. */
  loadIntraday(ticker: string): Promise<Candle[]>;
  /** All of a ticker's daily bars (the period plus enough before it); [] when none. */
  loadDaily(ticker: string): Promise<Candle[]>;
  /** Progress lines; optional. */
  log?: (msg: string) => void;
}

export interface ReplaySummary {
  ruleVersion: string;
  period: { from: string; to: string };
  sessions: number;
  /** Tickers asked for, and how many of them had any 5-minute bars. */
  universe: number;
  tickersWithData: number;
  /** (ticker, session) pairs picked into the top CHART_TOP_N. */
  picks: number;
  setupsFound: number;
  /** Primary-exit fill status: filled = got a fill (closed or still open at the end). */
  filled: number;
  notFilled: number;
  open: number;
  stats: Record<ExitVariant, GroupStats>;
  /** Random control of the primary (hold) exit; null when no control run produced a value. */
  control: { median: number; p95: number; runs: number } | null;
  /** Primary mean R strictly above the control's p95. */
  pass: boolean;
  /** Per session (by setup date): cumulative primary R of closed trades, and their count so far. */
  cumulativeR: { date: string; cumR: number; n: number }[];
  biases: string[];
}

/** 10:30 ET on `date` in epoch seconds. No DST switch happens inside a trading day. */
export function replayRunAtSec(date: string): number {
  return etSessionCloseMs(date) / 1000 - (CLOSE_MIN - SCORECARD_RUN_ET_MINUTES) * 60;
}

interface Scored {
  ticker: string;
  session: string;
  runAtSec: number;
  stop: number;
  t1: number;
  bars: Candle[];
  hold: Outcome;
  sameDay: Outcome;
}

/** Regular bars of `session` and the next sessions, up to the hold cap: all scoreSetup can read. */
function scoringBars(idx: IntradayIndex, session: string): Candle[] {
  const i = lowerBound(idx.dates, session);
  return idx.dates
    .slice(i, i + SCORECARD_MAX_HOLD_SESSIONS)
    .flatMap((d) => idx.byDate.get(d)!.regular);
}

/** The bars the live agent would have at the cutoff: a few prior sessions plus today so far. */
function barsAtCutoff(idx: IntradayIndex, session: string, cutoffSec: number): Candle[] {
  const i = lowerBound(idx.dates, session);
  const prior = idx.dates.slice(Math.max(0, i - PRIOR_SESSIONS_FOR_SPLIT), i).flatMap((d) => idx.byDate.get(d)!.all);
  const today = (idx.byDate.get(session)?.all ?? []).filter((b) => b.t + CHART_BAR_SECONDS <= cutoffSec);
  return [...prior, ...today];
}

export async function runReplay(deps: ReplayDeps): Promise<ReplaySummary> {
  const sessions = [...new Set(deps.sessions)].sort();
  if (sessions.length === 0) throw new Error("runReplay: no sessions");
  const universe = [...new Set(deps.universe)];
  const log = deps.log ?? (() => {});
  const from = sessions[0];
  const to = sessions[sessions.length - 1];
  const endCutoffSec = etSessionCloseMs(to) / 1000;
  const findCutoff = (s: string) => replayRunAtSec(s) - SIP_DELAY_MS / 1000;

  // Pass 1: one small scan row per (ticker, session).
  const rowsBySession = new Map<string, TvRow[]>(sessions.map((s) => [s, []]));
  let tickersWithData = 0;
  for (let k = 0; k < universe.length; k++) {
    const ticker = universe[k];
    const intraday = await deps.loadIntraday(ticker);
    if (intraday.length > 0) {
      tickersWithData++;
      const ii = indexIntraday(intraday);
      const di = indexDaily(await deps.loadDaily(ticker));
      for (const s of sessions) {
        const row = replayRowFromIndex(ticker, di, ii, s, findCutoff(s));
        if (row) rowsBySession.get(s)!.push(row);
      }
    }
    if ((k + 1) % 25 === 0 || k + 1 === universe.length) log(`rank: ${k + 1}/${universe.length} tickers`);
  }

  // Pass 2: the top CHART_TOP_N of each session.
  const picked = new Map<string, string[]>();
  let picks = 0;
  for (const s of sessions) {
    for (const ticker of pickTopN(rowsBySession.get(s)!)) {
      const list = picked.get(ticker) ?? [];
      list.push(s);
      picked.set(ticker, list);
      picks++;
    }
  }
  rowsBySession.clear();

  // Pass 3: the live setup pipeline on each pick, then score both exits.
  const scored: Scored[] = [];
  const pickedTickers = universe.filter((t) => picked.has(t));
  for (let k = 0; k < pickedTickers.length; k++) {
    const ticker = pickedTickers[k];
    const ii = indexIntraday(await deps.loadIntraday(ticker));
    const di = indexDaily(await deps.loadDaily(ticker));
    for (const s of picked.get(ticker)!) {
      const runAtSec = replayRunAtSec(s);
      const split = splitSessions(barsAtCutoff(ii, s, findCutoff(s)), s);
      const lv = computeLevels(split);
      if ("error" in lv) continue;
      const outcome = findSetup(ticker, split, lv.levels, replayDailyAtr(di, s));
      if (outcome.kind !== "setup") continue;
      const { stop, t1 } = outcome.setup;
      const bars = scoringBars(ii, s);
      const score = (variant: ExitVariant) =>
        scoreSetup({ runAtSec, stop, t1: t1.price, bars, cutoffSec: endCutoffSec, variant });
      scored.push({ ticker, session: s, runAtSec, stop, t1: t1.price, bars, hold: score("hold"), sameDay: score("sameDay") });
    }
    if ((k + 1) % 25 === 0 || k + 1 === pickedTickers.length) log(`setups: ${k + 1}/${pickedTickers.length} tickers`);
  }

  // Deterministic order: (session, ticker). The control's ids come from it.
  scored.sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  const filled = scored.filter((x) => x.hold.fill !== null);
  const trades: ControlTrade[] = filled.map((x, id) => ({
    id,
    runAtSec: x.runAtSec,
    fill: x.hold.fill as number,
    stop: x.stop,
    t1: x.t1,
    bars: x.bars,
    cutoffSec: endCutoffSec,
  }));
  log(`control: ${trades.length} filled setups`);
  const dist = trades.length > 0 ? controlDistribution(trades, "hold") : null;
  const control = dist ? { median: dist.median, p95: dist.p95, runs: dist.runs } : null;

  const stats = {
    hold: summarize(scored.map((x) => x.hold)),
    sameDay: summarize(scored.map((x) => x.sameDay)),
  };
  const pass = control !== null && stats.hold.meanR !== null && beatsControl(stats.hold.meanR, dist!);

  let cumR = 0;
  let n = 0;
  const cumulativeR = sessions.map((date) => {
    for (const x of scored) {
      if (x.session !== date || x.hold.status !== "closed" || x.hold.r === null) continue;
      cumR += x.hold.r;
      n++;
    }
    return { date, cumR, n };
  });

  return {
    ruleVersion: CHART_RULE_VERSION,
    period: { from, to },
    sessions: sessions.length,
    universe: universe.length,
    tickersWithData,
    picks,
    setupsFound: scored.length,
    filled: filled.length,
    notFilled: scored.filter((x) => x.hold.status === "not_filled").length,
    open: scored.filter((x) => x.hold.status === "open" && x.hold.fill !== null).length,
    stats,
    control,
    pass,
    cumulativeR,
    biases: [...REPLAY_BIASES],
  };
}
