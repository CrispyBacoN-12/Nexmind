// Job 2 of the scorecard (spec §8): each morning at 07:00 ICT, after the US close,
// score every scheduled chart-agent setup on real bars, rebuild the live snapshot the
// /scorecard page reads, freeze the AI verdict exactly once when its 300-row sample is
// ready, and send one Thai Discord summary.
//
// Pure orchestration: every I/O dependency is injected (scripts/scorecard-score.mts
// wires the real ones). Read-only toward the market: it never places or sizes an order.
//
// Bars. One fetch per night covers the rows still being scored (from the earliest one's
// createdAt − 1 day to now − SIP delay). Rows that are already terminal and older than
// that window are not re-fetched, so:
//  - `windowElapsed` is known only for rows inside tonight's bars;
//  - the LIVE kept control covers only the filled kept rows inside tonight's bars. It is
//    informational, and may be survivor-biased while windows are open (a control trade
//    that has not closed yet sits its run out). It is never the verdict.
//  - The frozen verdict fetches its own sample's bars (one call per run date, a bounded
//    window each), only on nights when all 300 sample rows have closed, and computes the
//    control on exactly that sample.

import type { Candle } from "@/lib/indicators";
import { CHART_BAR_SECONDS, CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { SIP_DELAY_MS } from "@/lib/alpaca";
import { etClock, etSessionCloseMs } from "@/lib/scanAgent/session";
import { buildDiscordMessage, type ClosedLine, type OpenLine } from "./discord";
import { controlDistribution, type ControlTrade } from "./control";
import { etDayBoundsMs } from "./etDay";
import { aiVerdictSample, beatsControl, groupOf, summarize, type Group, type GroupStats } from "./groups";
import type { ScorecardRunInput } from "./runDaily";
import { scoreSetup } from "./score";
import {
  SCORECARD_MAX_HOLD_SESSIONS,
  SCORECARD_NO_DATA_DAYS,
  SCORECARD_RUN_ET_MINUTES,
  SCORECARD_RUN_WINDOW_MINUTES,
  SCORECARD_VERDICT_N,
  type ExitVariant,
  type Outcome,
} from "./types";

const VARIANTS: readonly ExitVariant[] = ["hold", "sameDay"];
const GROUPS: readonly Group[] = ["kept", "vetoed", "stripped", "unread"];
const OPEN_MIN = 570; // 09:30 ET
const CLOSE_MIN = 960; // 16:00 ET
const DAY_SEC = 86_400;
/** Calendar days of bars fetched per run date for the verdict sample; holds 10 sessions with room for holidays. */
const VERDICT_WINDOW_DAYS = 30;
const MISSED_LOOKBACK_WEEKDAYS = 30;
const RECENT_TRADES = 30;

/** One scheduled `ChartSetup` row of the current ruleVersion with its stored outcomes. */
export interface NightlyRow {
  id: number;
  createdAt: Date;
  ticker: string;
  status: string;
  aiReading: string | null;
  aiModel: string | null;
  entry: number;
  stop: number;
  t1: number;
  outcomes: Partial<Record<ExitVariant, Outcome>>;
}

/** A `ScorecardRun` row as read back: the create input plus the time it was written. */
export type NightlyRun = ScorecardRunInput & { ranAt: Date };

export interface NightlyDeps {
  now(): number;
  /** Scheduled rows of the current ruleVersion, each with its stored outcomes. */
  loadRows(): Promise<NightlyRow[]>;
  /** 5-minute bars for `tickers` over [fromSec, toSec] (epoch seconds). */
  fetchBars(tickers: string[], fromSec: number, toSec: number): Promise<Map<string, Candle[]>>;
  /** Upsert on (chartSetupId, variant). */
  saveOutcomes(rows: { chartSetupId: number; variant: ExitVariant; outcome: Outcome }[]): Promise<void>;
  /** Every run row whose sessionDate >= sinceSession. */
  loadRuns(sinceSession: string): Promise<NightlyRun[]>;
  /** The stored "ai-verdict" snapshot's data for the current ruleVersion, or null. */
  loadVerdict(): Promise<unknown | null>;
  saveLive(data: LiveSnapshot): Promise<void>;
  /** Must refuse (throw) when a verdict already exists. */
  saveVerdict(data: AiVerdict): Promise<void>;
  send(message: string): Promise<void>;
}

export type StatsGroup = Group | "afterVerdict";

export interface GroupCounts {
  total: number;
  filled: number;
  closed: number;
  open: number;
  notFilled: number;
  noData: number;
}

export interface LastRunSummary {
  /** ET date of the most recent weekday whose run window has passed. */
  sessionDate: string;
  /** "none" = no run row and no logged setup for that date. */
  status: "ran" | "no_session" | "failed" | "none";
  /** ISO time the run row was written (or the first setup logged, for orphan rows). */
  ranAt: string | null;
  error: string | null;
  /** Counted from that date's ChartSetup rows via groupOf, not from the run row. */
  setups: number;
  kept: number;
  vetoed: number;
  stripped: number;
  unread: number;
  /** Setups were unread and none was kept: the AI did not answer. */
  aiDown: boolean;
}

export interface RecentTrade {
  id: number;
  /** ET date of the run. */
  date: string;
  ticker: string;
  group: Group;
  fill: number | null;
  stop: number;
  t1: number;
  hold: { status: Outcome["status"]; r: number | null; reason: Outcome["exitReason"]; sessionsHeld: number };
}

/** Frozen once per ruleVersion when the first 300 kept, filled setups have all closed. */
export interface AiVerdict {
  ruleVersion: string;
  n: number;
  meanR: number;
  controlMedian: number;
  controlP95: number;
  /** Control runs that produced a value. */
  runs: number;
  /** meanR strictly above controlP95. */
  pass: boolean;
  computedAt: string;
  firstId: number;
  lastId: number;
  modelMix: Record<string, number>;
}

export interface LiveSnapshot {
  ruleVersion: string;
  computedAt: string;
  /** Last night's ET session date. */
  sessionDate: string;
  /**
   * Closed outcomes only. Before the verdict is frozen `kept` is every kept row; after,
   * `kept` is the rows up to the sample's last one and `afterVerdict` the rest (info only).
   */
  stats: Record<StatsGroup, Record<ExitVariant, GroupStats>>;
  /** Primary (hold) outcome status counts. */
  counts: Record<StatsGroup, GroupCounts>;
  /** Live random control for kept (hold), informational: see the file header. */
  keptControl: { median: number; p95: number; runs: number; trades: number } | null;
  /** The verdict sample so far: kept, filled, earliest first, at most 300. */
  keptProgress: { n: number; closed: number; meanR: number | null; target: number };
  /** aiModel counts over the verdict sample so far ("unknown" when null). */
  modelMix: Record<string, number>;
  /** Primary exit, closed rows, credited on the ET exit date. */
  cumulativeR: Record<Group, { date: string; cumR: number; n: number }[]>;
  /** Weekdays of the last 30 with no ran/no_session row and no logged setup. */
  missed: { date: string; failed: string | null }[];
  lastRun: LastRunSummary;
  /** Newest 30 rows first. */
  recentTrades: RecentTrade[];
  verdict: AiVerdict | null;
}

const NO_OUTCOME: Outcome = {
  status: "open",
  fillAt: null,
  fill: null,
  exitAt: null,
  exitPrice: null,
  exitReason: null,
  r: null,
  sessionsHeld: 0,
};

const isRegular = (b: Candle, cutoffSec: number) => {
  if (b.t + CHART_BAR_SECONDS > cutoffSec) return false;
  const { minutes } = etClock(b.t);
  return minutes >= OPEN_MIN && minutes < CLOSE_MIN;
};

/** Any finished regular bar on the ET date of `runAtSec`. */
function hasRunDateBar(bars: Candle[], runAtSec: number, cutoffSec: number): boolean {
  const runDate = etClock(runAtSec).date;
  return bars.some((b) => isRegular(b, cutoffSec) && etClock(b.t).date === runDate);
}

/**
 * True once SCORECARD_MAX_HOLD_SESSIONS complete sessions, counting the fill date as the
 * first, appear in the row's own finished regular bars: by then every control trade of
 * that row (entered the same day, held at most as long) has closed. No fill: false.
 */
export function windowElapsed(bars: Candle[], fillAt: number | null, cutoffSec: number): boolean {
  if (fillAt === null) return false;
  const fillDate = etClock(fillAt).date;
  const dates = new Set<string>();
  for (const b of bars) {
    if (!isRegular(b, cutoffSec)) continue;
    const d = etClock(b.t).date;
    if (d >= fillDate) dates.add(d);
  }
  const sorted = [...dates].sort();
  if (sorted.length < SCORECARD_MAX_HOLD_SESSIONS) return false;
  return cutoffSec * 1000 >= etSessionCloseMs(sorted[SCORECARD_MAX_HOLD_SESSIONS - 1]);
}

const isWeekday = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The latest weekday whose 10:30-11:30 ET run window has fully passed at `nowMs`. */
export function lastRunSession(nowMs: number): string {
  const { date, minutes } = etClock(Math.floor(nowMs / 1000));
  let d = isWeekday(date) && minutes >= SCORECARD_RUN_ET_MINUTES + SCORECARD_RUN_WINDOW_MINUTES ? date : addDays(date, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

const order = (a: NightlyRow, b: NightlyRow) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
const runAtSec = (r: NightlyRow) => Math.floor(r.createdAt.getTime() / 1000);
const runDateOf = (r: NightlyRow) => etClock(runAtSec(r)).date;

function isAiVerdict(x: unknown): x is AiVerdict {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return typeof v.n === "number" && typeof v.pass === "boolean" && typeof v.controlP95 === "number" && typeof v.meanR === "number";
}

function countsOf(outcomes: Outcome[]): GroupCounts {
  const c: GroupCounts = { total: outcomes.length, filled: 0, closed: 0, open: 0, notFilled: 0, noData: 0 };
  for (const o of outcomes) {
    if (o.fill !== null) c.filled++;
    if (o.status === "closed") c.closed++;
    else if (o.status === "open") c.open++;
    else if (o.status === "not_filled") c.notFilled++;
    else c.noData++;
  }
  return c;
}

function modelMixOf(rows: NightlyRow[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const r of rows) {
    const k = r.aiModel ?? "unknown";
    mix[k] = (mix[k] ?? 0) + 1;
  }
  return mix;
}

function cumulative(rows: { id: number; hold: Outcome }[]): { date: string; cumR: number; n: number }[] {
  const closed = rows
    .filter((r) => r.hold.status === "closed" && r.hold.r !== null && r.hold.exitAt !== null)
    .sort((a, b) => (a.hold.exitAt as number) - (b.hold.exitAt as number) || a.id - b.id);
  const out: { date: string; cumR: number; n: number }[] = [];
  let cumR = 0;
  let n = 0;
  for (const r of closed) {
    cumR += r.hold.r as number;
    n++;
    const date = etClock(r.hold.exitAt as number).date;
    const last = out[out.length - 1];
    if (last && last.date === date) {
      last.cumR = cumR;
      last.n = n;
    } else out.push({ date, cumR, n });
  }
  return out;
}

/**
 * The regular bars of the run date and the next sessions up to SCORECARD_MAX_HOLD_SESSIONS:
 * all scoreSetup can read for a control trade entered that day. The control scores every
 * trade 200 times, so passing weeks of extended-hours bars would only cost time.
 */
function controlWindow(bars: Candle[], runAt: number): Candle[] {
  const runDate = etClock(runAt).date;
  const kept: { b: Candle; date: string }[] = [];
  for (const b of bars) {
    const { date, minutes } = etClock(b.t);
    if (date >= runDate && minutes >= OPEN_MIN && minutes < CLOSE_MIN) kept.push({ b, date });
  }
  const dates = new Set([...new Set(kept.map((k) => k.date))].sort().slice(0, SCORECARD_MAX_HOLD_SESSIONS));
  return kept.filter((k) => dates.has(k.date)).map((k) => k.b);
}

const toTrade = (r: NightlyRow, hold: Outcome, bars: Candle[], cutoffSec: number): ControlTrade => ({
  id: r.id,
  runAtSec: runAtSec(r),
  fill: hold.fill as number,
  stop: r.stop,
  t1: r.t1,
  bars: controlWindow(bars, runAtSec(r)),
  cutoffSec,
});

export async function runScorecardNightly(deps: NightlyDeps): Promise<LiveSnapshot> {
  const nowMs = deps.now();
  const cutoffSec = Math.floor((nowMs - SIP_DELAY_MS) / 1000);
  const rows = [...(await deps.loadRows())].sort(order);

  // 1. Score what is missing or still open. Terminal outcomes are never rescored.
  const needs = (r: NightlyRow, v: ExitVariant) => {
    const o = r.outcomes[v];
    return !o || o.status === "open";
  };
  const toScore = rows.filter((r) => VARIANTS.some((v) => needs(r, v)));
  let bars = new Map<string, Candle[]>();
  let barsFromSec = Infinity;
  if (toScore.length) {
    barsFromSec = Math.min(...toScore.map(runAtSec)) - DAY_SEC;
    bars = await deps.fetchBars([...new Set(toScore.map((r) => r.ticker))], barsFromSec, cutoffSec);
  }
  /** Tonight's bars for a row, or null when its run is before the fetch or its ticker got none. */
  const barsFor = (r: NightlyRow): Candle[] | null => (runAtSec(r) >= barsFromSec ? (bars.get(r.ticker) ?? null) : null);

  const outcomes = new Map<number, Partial<Record<ExitVariant, Outcome>>>(rows.map((r) => [r.id, { ...r.outcomes }]));
  const updates: { chartSetupId: number; variant: ExitVariant; outcome: Outcome }[] = [];
  const closedTonight = new Set<number>();
  for (const r of toScore) {
    const rowBars = barsFor(r) ?? [];
    const current = outcomes.get(r.id)!;
    const noBars = !hasRunDateBar(rowBars, runAtSec(r), cutoffSec);
    for (const v of VARIANTS) {
      if (!needs(r, v)) continue;
      let next: Outcome;
      if (noBars) {
        // A fill already seen is kept as it is: missing bars tonight are a feed gap, not news.
        if (current[v]?.fill != null) continue;
        const stale = nowMs - r.createdAt.getTime() >= SCORECARD_NO_DATA_DAYS * DAY_SEC * 1000;
        next = { ...NO_OUTCOME, status: stale ? "no_data" : "open" };
      } else {
        next = scoreSetup({ runAtSec: runAtSec(r), stop: r.stop, t1: r.t1, bars: rowBars, cutoffSec, variant: v });
      }
      current[v] = next;
      updates.push({ chartSetupId: r.id, variant: v, outcome: next });
      if (v === "hold" && next.status === "closed") closedTonight.add(r.id);
    }
  }
  if (updates.length) await deps.saveOutcomes(updates);

  const holdOf = (r: NightlyRow): Outcome => outcomes.get(r.id)!.hold ?? NO_OUTCOME;
  const sameDayOf = (r: NightlyRow): Outcome => outcomes.get(r.id)!.sameDay ?? NO_OUTCOME;
  const groupMap = new Map(rows.map((r) => [r.id, groupOf(r)]));
  const groupOfRow = (r: NightlyRow) => groupMap.get(r.id)!;

  // 2. The verdict sample and, when it is ready and none is stored, the frozen verdict.
  const elapsed = new Map<number, boolean>();
  for (const r of rows) {
    const b = barsFor(r);
    elapsed.set(r.id, b !== null && windowElapsed(b, holdOf(r).fillAt, cutoffSec));
  }
  const candidates = () =>
    rows.map((r) => ({ id: r.id, createdAt: r.createdAt, group: groupOfRow(r), hold: holdOf(r), windowElapsed: elapsed.get(r.id)!, row: r }));
  let sample = aiVerdictSample(candidates());

  const stored = await deps.loadVerdict();
  let verdict: AiVerdict | null = isAiVerdict(stored) ? stored : null;
  if (stored === null && sample.sample.length === SCORECARD_VERDICT_N && sample.sample.every((s) => s.hold.status === "closed")) {
    // The sample's own bars: one bounded fetch per run date.
    const sampleBars = new Map<number, Candle[]>();
    const byDate = new Map<string, NightlyRow[]>();
    for (const s of sample.sample) {
      const d = runDateOf(s.row);
      byDate.set(d, [...(byDate.get(d) ?? []), s.row]);
    }
    for (const [, dateRows] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      const from = Math.min(...dateRows.map(runAtSec)) - DAY_SEC;
      const to = Math.min(cutoffSec, from + VERDICT_WINDOW_DAYS * DAY_SEC);
      const got = await deps.fetchBars([...new Set(dateRows.map((r) => r.ticker))], from, to);
      for (const r of dateRows) sampleBars.set(r.id, got.get(r.ticker) ?? []);
    }
    for (const s of sample.sample) elapsed.set(s.id, windowElapsed(sampleBars.get(s.id)!, s.hold.fillAt, cutoffSec));
    sample = aiVerdictSample(candidates());
    if (sample.ready) {
      const trades = sample.sample.map((s) => toTrade(s.row, s.hold, sampleBars.get(s.id)!, cutoffSec));
      const control = controlDistribution(trades, "hold");
      const meanR = summarize(sample.sample.map((s) => s.hold)).meanR;
      if (control && meanR !== null) {
        verdict = {
          ruleVersion: CHART_RULE_VERSION,
          n: sample.sample.length,
          meanR,
          controlMedian: control.median,
          controlP95: control.p95,
          runs: control.runs,
          pass: beatsControl(meanR, control),
          computedAt: new Date(nowMs).toISOString(),
          firstId: sample.sample[0].id,
          lastId: sample.sample[sample.sample.length - 1].id,
          modelMix: modelMixOf(sample.sample.map((s) => s.row)),
        };
        await deps.saveVerdict(verdict);
      }
    }
  }

  // 3. Groups. Once frozen, kept rows after the sample's last one are "afterVerdict".
  const boundary = verdict && sample.sample.length ? sample.sample[sample.sample.length - 1].row : null;
  const statsGroupOf = (r: NightlyRow): StatsGroup => {
    const g = groupOfRow(r);
    return g === "kept" && boundary && order(r, boundary) > 0 ? "afterVerdict" : g;
  };
  const statsGroups: readonly StatsGroup[] = [...GROUPS, "afterVerdict"];
  const stats = {} as LiveSnapshot["stats"];
  const counts = {} as LiveSnapshot["counts"];
  for (const g of statsGroups) {
    const members = rows.filter((r) => statsGroupOf(r) === g);
    stats[g] = { hold: summarize(members.map(holdOf)), sameDay: summarize(members.map(sameDayOf)) };
    counts[g] = countsOf(members.map(holdOf));
  }

  // Live kept control: filled kept rows inside tonight's bars (informational).
  const liveTrades = rows
    .filter((r) => groupOfRow(r) === "kept" && holdOf(r).fill !== null && barsFor(r) !== null)
    .map((r) => toTrade(r, holdOf(r), barsFor(r)!, cutoffSec));
  const liveControl = liveTrades.length ? controlDistribution(liveTrades, "hold") : null;
  const keptControl = liveControl
    ? { median: liveControl.median, p95: liveControl.p95, runs: liveControl.runs, trades: liveTrades.length }
    : null;

  const sampleHolds = sample.sample.map((s) => s.hold);
  const keptProgress = {
    n: sample.sample.length,
    closed: sampleHolds.filter((o) => o.status === "closed").length,
    meanR: summarize(sampleHolds).meanR,
    target: SCORECARD_VERDICT_N,
  };

  const cumulativeR = {} as LiveSnapshot["cumulativeR"];
  for (const g of GROUPS) cumulativeR[g] = cumulative(rows.filter((r) => groupOfRow(r) === g).map((r) => ({ id: r.id, hold: holdOf(r) })));

  // 4. Last night's run and the missed weekdays.
  const sessionDate = lastRunSession(nowMs);
  const weekdays: string[] = [];
  for (let d = sessionDate; weekdays.length < MISSED_LOOKBACK_WEEKDAYS; d = addDays(d, -1)) if (isWeekday(d)) weekdays.unshift(d);
  const runs = await deps.loadRuns(weekdays[0]);
  const rowsOn = (date: string) => {
    const { startMs, endMs } = etDayBoundsMs(date);
    return rows.filter((r) => r.createdAt.getTime() >= startMs && r.createdAt.getTime() < endMs);
  };
  const done = (date: string) =>
    runs.some((r) => r.sessionDate === date && (r.status === "ran" || r.status === "no_session")) || rowsOn(date).length > 0;
  // Nothing before the scorecard's first sign of life counts as missed.
  const firstSeen = [...runs.map((r) => r.sessionDate), ...rows.map(runDateOf)].sort()[0];
  const missed = firstSeen
    ? weekdays
        .filter((d) => d >= firstSeen && !done(d))
        .map((date) => {
          const failed = runs.filter((r) => r.sessionDate === date && r.status === "failed").sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())[0];
          return { date, failed: failed ? (failed.error ?? "ล้มเหลว") : null };
        })
    : [];

  const lastRows = rowsOn(sessionDate);
  const lastCounts = { kept: 0, vetoed: 0, stripped: 0, unread: 0 };
  for (const r of lastRows) lastCounts[groupOfRow(r)]++;
  const sessionRuns = runs.filter((r) => r.sessionDate === sessionDate).sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  const okRun = sessionRuns.find((r) => r.status === "ran" || r.status === "no_session");
  const failedRun = sessionRuns.find((r) => r.status === "failed");
  let status: LastRunSummary["status"] = "none";
  let ranAt: string | null = null;
  let error: string | null = null;
  if (okRun) {
    status = okRun.status as "ran" | "no_session";
    ranAt = okRun.ranAt.toISOString();
  } else if (lastRows.length) {
    status = "ran"; // orphan rows: the setups were logged, only the run row is missing
    ranAt = lastRows[0].createdAt.toISOString();
  } else if (failedRun) {
    status = "failed";
    ranAt = failedRun.ranAt.toISOString();
    error = failedRun.error ?? null;
  }
  const lastRun: LastRunSummary = {
    sessionDate,
    status,
    ranAt,
    error,
    setups: lastRows.length,
    ...lastCounts,
    aiDown: lastCounts.unread > 0 && lastCounts.kept === 0,
  };

  const recentTrades: RecentTrade[] = [...rows]
    .sort((a, b) => order(b, a))
    .slice(0, RECENT_TRADES)
    .map((r) => {
      const h = holdOf(r);
      return {
        id: r.id,
        date: runDateOf(r),
        ticker: r.ticker,
        group: groupOfRow(r),
        fill: h.fill,
        stop: r.stop,
        t1: r.t1,
        hold: { status: h.status, r: h.r, reason: h.exitReason, sessionsHeld: h.sessionsHeld },
      };
    });

  const snapshot: LiveSnapshot = {
    ruleVersion: CHART_RULE_VERSION,
    computedAt: new Date(nowMs).toISOString(),
    sessionDate,
    stats,
    counts,
    keptControl,
    keptProgress,
    modelMix: modelMixOf(sample.sample.map((s) => s.row)),
    cumulativeR,
    missed,
    lastRun,
    recentTrades,
    verdict,
  };
  await deps.saveLive(snapshot);

  // 5. Discord.
  const closedOvernight: ClosedLine[] = rows
    .filter((r) => closedTonight.has(r.id))
    .map((r) => ({ ticker: r.ticker, group: groupOfRow(r), r: holdOf(r).r as number, reason: holdOf(r).exitReason! }));
  const openNow: OpenLine[] = rows
    .filter((r) => holdOf(r).status === "open" && holdOf(r).fill !== null)
    .map((r) => ({ ticker: r.ticker, group: groupOfRow(r), sessionsHeld: holdOf(r).sessionsHeld }));
  await deps.send(buildDiscordMessage({ snapshot, lastRun, sessionDate, closedOvernight, openNow }));

  return snapshot;
}
