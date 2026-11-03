// Job 2 of the scorecard (spec §8): each morning at 07:00 ICT, after the US close,
// score every scheduled chart-agent setup on real bars, rebuild the live snapshot the
// /scorecard page reads, freeze the AI verdict exactly once when its 300-row sample is
// ready, and send one Thai Discord summary.
//
// Pure orchestration: every I/O dependency is injected (scripts/scorecard-score.mts
// wires the real ones). Read-only toward the market: it never places or sizes an order.
//
// Bars. One fetch per night: the tickers of the rows still being scored plus SPY, from
// the earliest such createdAt − 1 day (or, while the verdict waits, the 300th sample
// row's) to now − SIP delay.
//  - SPY is the market calendar. A row's 10-session window is counted on SPY's completed
//    regular sessions from its fill date (fill date = 1), never on the row's own bars, so a
//    halted or renamed ticker cannot hold the verdict back.
//  - A filled row still `open` once that window has elapsed is closed on time at its last
//    finished regular close (its own bars stopped). It stays in every sample. Only on a
//    night that has its run-date bars: without them the row is left as stored, except that
//    a ticker returning no bar at all after the window becomes no_data (fill kept) and
//    leaves the verdict sample.
//  - There is no live random control. The control is computed once, on exactly the
//    300-row verdict sample, the night it is ready (one bounded bar fetch per run date),
//    and frozen with the verdict.

import type { Candle } from "@/lib/indicators";
import { CHART_BAR_SECONDS, CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { SIP_DELAY_MS } from "@/lib/alpaca";
import { etClock, etSessionCloseMs } from "@/lib/scanAgent/session";
import { buildDiscordMessage, type ClosedLine, type OpenLine } from "./discord";
import { controlDistribution, eligibleBars, type ControlTrade } from "./control";
import { etDayBoundsMs } from "./etDay";
import { aiVerdictSample, beatsControl, groupOf, summarize, type Group, type GroupStats } from "./groups";
import type { ScorecardRunInput } from "./runDaily";
import { rMultiple, scoreSetup } from "./score";
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
/** The market calendar: its completed regular sessions count every row's window. */
const CALENDAR_TICKER = "SPY";
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
  /** The run logged setups and every one was unread: the AI did not answer. A veto or a strip proves it did. */
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
   * `kept` is the rows up to the stored verdict's lastId and `afterVerdict` the rest (info only).
   */
  stats: Record<StatsGroup, Record<ExitVariant, GroupStats>>;
  /** Primary (hold) outcome status counts. */
  counts: Record<StatsGroup, GroupCounts>;
  /** The FROZEN verdict's random control (hold); null until the verdict exists. No live control is computed. */
  keptControl: { median: number; p95: number; runs: number } | null;
  /** The verdict sample so far: kept, filled, earliest first, at most 300. */
  keptProgress: { n: number; closed: number; meanR: number | null; target: number };
  /** aiModel counts over the verdict sample so far ("unknown" when null). */
  modelMix: Record<string, number>;
  /** Primary exit, closed rows, credited on the ET exit date; split like `stats` (kept excludes afterVerdict). */
  cumulativeR: Record<StatsGroup, { date: string; cumR: number; n: number }[]>;
  /** Weekdays of the last 30 with no ran/no_session row and no logged setup. */
  missed: { date: string; failed: string | null }[];
  lastRun: LastRunSummary;
  /** Newest 30 rows first. */
  recentTrades: RecentTrade[];
  verdict: AiVerdict | null;
  /**
   * Why a ready sample was not frozen tonight (a sample row without run-date bars or an
   * eligible control bar, or SPY not covering its 10 sessions); retried the next night.
   * Null when no verdict was due or it was frozen.
   */
  verdictPending: string | null;
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

/** Sorted distinct ET dates that have a finished regular bar. */
function sessionDates(bars: Candle[], cutoffSec: number): string[] {
  const dates = new Set<string>();
  for (const b of bars) if (isRegular(b, cutoffSec)) dates.add(etClock(b.t).date);
  return [...dates].sort();
}

/** `windowElapsed` on precomputed calendar dates (one pass over SPY per night, not per row). */
function elapsedOn(calendar: string[], fillAt: number | null, cutoffSec: number): boolean {
  if (fillAt === null) return false;
  const fillDate = etClock(fillAt).date;
  const i = calendar.findIndex((d) => d >= fillDate);
  if (i < 0) return false;
  const last = calendar[i + SCORECARD_MAX_HOLD_SESSIONS - 1];
  return last !== undefined && cutoffSec * 1000 >= etSessionCloseMs(last);
}

/**
 * True once SCORECARD_MAX_HOLD_SESSIONS complete sessions, counting the fill date as the
 * first, appear in the CALENDAR bars (SPY): by then every control trade of that row
 * (entered the same day, held at most as long) has run its course. No fill: false.
 */
export function windowElapsed(calendarBars: Candle[], fillAt: number | null, cutoffSec: number): boolean {
  return elapsedOn(sessionDates(calendarBars, cutoffSec), fillAt, cutoffSec);
}

/**
 * An outcome still `open` with a fill whose SPY-counted window has elapsed: the row's own
 * bars stopped (halt, rename, delisting). Close it on time at its last finished regular
 * close inside the variant's sessions; sessionsHeld = its own sessions walked. With no own
 * bar tonight it stays open (nothing to price it at).
 */
function closeAfterWindow(o: Outcome, own: Candle[], variant: ExitVariant, stop: number, elapsed: boolean, cutoffSec: number): Outcome {
  if (o.status !== "open" || o.fill === null || o.fillAt === null || !elapsed) return o;
  const fillAt = o.fillAt;
  const walked = own.filter((b) => b.t >= fillAt && isRegular(b, cutoffSec)).sort((a, b) => a.t - b.t);
  const maxSessions = variant === "sameDay" ? 1 : SCORECARD_MAX_HOLD_SESSIONS;
  const dates = [...new Set(walked.map((b) => etClock(b.t).date))].slice(0, maxSessions);
  const inside = walked.filter((b) => dates.includes(etClock(b.t).date));
  const last = inside[inside.length - 1];
  if (!last) return o;
  return {
    status: "closed",
    fillAt,
    fill: o.fill,
    exitAt: last.t + CHART_BAR_SECONDS,
    exitPrice: last.c,
    exitReason: "time",
    r: rMultiple(o.fill, last.c, stop),
    sessionsHeld: dates.length,
  };
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
  return (
    typeof v.n === "number" &&
    typeof v.pass === "boolean" &&
    typeof v.controlP95 === "number" &&
    typeof v.controlMedian === "number" &&
    typeof v.meanR === "number" &&
    typeof v.lastId === "number"
  );
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
export function controlWindow(bars: Candle[], runAt: number): Candle[] {
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
  const groupMap = new Map(rows.map((r) => [r.id, groupOf(r)]));
  const groupOfRow = (r: NightlyRow) => groupMap.get(r.id)!;

  // While no verdict is stored and the sample is already full, SPY must also reach back to
  // the sample's last run, so its readiness can be read even on a night with nothing to score.
  const stored = await deps.loadVerdict();
  const pre = aiVerdictSample(
    rows.map((r) => ({ id: r.id, createdAt: r.createdAt, group: groupOfRow(r), hold: r.outcomes.hold ?? NO_OUTCOME, windowElapsed: false, row: r })),
  );
  const sampleAnchor = stored === null && pre.sample.length === SCORECARD_VERDICT_N ? runAtSec(pre.sample[SCORECARD_VERDICT_N - 1].row) : Infinity;
  const fetchFrom = Math.min(toScore.length ? Math.min(...toScore.map(runAtSec)) : Infinity, sampleAnchor);

  let bars = new Map<string, Candle[]>();
  let barsFromSec = Infinity;
  if (Number.isFinite(fetchFrom)) {
    barsFromSec = fetchFrom - DAY_SEC;
    bars = await deps.fetchBars([...new Set([...toScore.map((r) => r.ticker), CALENDAR_TICKER])], barsFromSec, cutoffSec);
  }
  /** Tonight's bars for a row, or null when its run is before the fetch or its ticker got none. */
  const barsFor = (r: NightlyRow): Candle[] | null => (runAtSec(r) >= barsFromSec ? (bars.get(r.ticker) ?? null) : null);
  // No SPY bars: nothing elapses tonight (no forced close, no freeze). Safe, never early.
  const calendar = sessionDates(bars.get(CALENDAR_TICKER) ?? [], cutoffSec);

  const outcomes = new Map<number, Partial<Record<ExitVariant, Outcome>>>(rows.map((r) => [r.id, { ...r.outcomes }]));
  const updates: { chartSetupId: number; variant: ExitVariant; outcome: Outcome }[] = [];
  const closedTonight = new Set<number>();
  for (const r of toScore) {
    const rowBars = barsFor(r) ?? [];
    const current = outcomes.get(r.id)!;
    const noBars = !hasRunDateBar(rowBars, runAtSec(r), cutoffSec);
    for (const v of VARIANTS) {
      if (!needs(r, v)) continue;
      const prev = current[v];
      let next: Outcome;
      if (noBars && prev?.fill != null) {
        // A fill already seen is kept: missing run-date bars tonight are a feed gap, not news.
        // Never closed on time from tonight's partial bars. But a ticker that returns no bar
        // at all once its SPY window has elapsed (delisted, renamed) can never be priced:
        // it becomes no_data, fill kept, so it leaves the verdict sample and stops pinning
        // the nightly fetch to its run date.
        next = rowBars.length === 0 && elapsedOn(calendar, prev.fillAt, cutoffSec) ? { ...prev, status: "no_data" } : prev;
      } else if (noBars) {
        const stale = nowMs - r.createdAt.getTime() >= SCORECARD_NO_DATA_DAYS * DAY_SEC * 1000;
        next = { ...NO_OUTCOME, status: stale ? "no_data" : "open" };
      } else {
        next = scoreSetup({ runAtSec: runAtSec(r), stop: r.stop, t1: r.t1, bars: rowBars, cutoffSec, variant: v });
        next = closeAfterWindow(next, rowBars, v, r.stop, elapsedOn(calendar, next.fillAt, cutoffSec), cutoffSec);
      }
      if (next === prev) continue;
      current[v] = next;
      updates.push({ chartSetupId: r.id, variant: v, outcome: next });
      if (v === "hold" && next.status === "closed") closedTonight.add(r.id);
    }
  }
  if (updates.length) await deps.saveOutcomes(updates);

  const holdOf = (r: NightlyRow): Outcome => outcomes.get(r.id)!.hold ?? NO_OUTCOME;
  const sameDayOf = (r: NightlyRow): Outcome => outcomes.get(r.id)!.sameDay ?? NO_OUTCOME;

  // 2. The verdict sample, its windows on the SPY calendar, and when it is ready and none
  //    is stored, the frozen verdict. The calendar counts from each row's own fill date;
  //    SPY may start after an early row's fill, which can only under-count (never early),
  //    and the sample's last row (fetched from) bounds every earlier one.
  const sample = aiVerdictSample(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      group: groupOfRow(r),
      hold: holdOf(r),
      windowElapsed: elapsedOn(calendar, holdOf(r).fillAt, cutoffSec),
      row: r,
    })),
  );

  let verdict: AiVerdict | null = isAiVerdict(stored) ? stored : null;
  let verdictPending: string | null = null;
  if (stored === null && sample.ready) {
    // The sample's own bars, for the control only: one bounded fetch per run date, with
    // SPY in it so each row's 10 sessions are checked on the same fetch.
    const sampleBars = new Map<number, Candle[]>();
    const covered = new Map<number, boolean>();
    const byDate = new Map<string, NightlyRow[]>();
    for (const s of sample.sample) {
      const d = runDateOf(s.row);
      byDate.set(d, [...(byDate.get(d) ?? []), s.row]);
    }
    const holdById = new Map(sample.sample.map((s) => [s.id, s.hold]));
    for (const [, dateRows] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      const from = Math.min(...dateRows.map(runAtSec)) - DAY_SEC;
      const to = Math.min(cutoffSec, from + VERDICT_WINDOW_DAYS * DAY_SEC);
      const got = await deps.fetchBars([...new Set([...dateRows.map((r) => r.ticker), CALENDAR_TICKER])], from, to);
      const spyDates = sessionDates(got.get(CALENDAR_TICKER) ?? [], to);
      for (const r of dateRows) {
        sampleBars.set(r.id, got.get(r.ticker) ?? []);
        covered.set(r.id, elapsedOn(spyDates, holdById.get(r.id)!.fillAt, to));
      }
    }
    const trades = sample.sample.map((s) => toTrade(s.row, s.hold, sampleBars.get(s.id)!, cutoffSec));

    // Freeze only on a complete sample: a missing fetch would otherwise just shrink the
    // control (a trade with no pool sits every run out) and the verdict is written once.
    const problems: string[] = [];
    sample.sample.forEach((s, i) => {
      const why: string[] = [];
      if (!hasRunDateBar(sampleBars.get(s.id)!, runAtSec(s.row), cutoffSec)) why.push("no bars on its run date");
      else if (eligibleBars(trades[i]).length === 0) why.push("no eligible control bar");
      if (!covered.get(s.id)) why.push(`fetched ${CALENDAR_TICKER} bars do not cover its ${SCORECARD_MAX_HOLD_SESSIONS} sessions`);
      if (why.length) problems.push(`#${s.id} ${s.row.ticker} (${why.join("; ")})`);
    });

    const control = problems.length ? null : controlDistribution(trades, "hold");
    const meanR = summarize(sample.sample.map((s) => s.hold)).meanR;
    if (problems.length) {
      const shown = problems.slice(0, 10).join(", ");
      verdictPending = `${problems.length} of ${sample.sample.length} sample rows not ready: ${shown}${problems.length > 10 ? ", ..." : ""}`;
    } else if (!control || meanR === null) {
      verdictPending = "the random control produced no value";
    } else {
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

  // 3. Groups. Once frozen, kept rows after the stored verdict's last row are "afterVerdict".
  const boundary = verdict
    ? (rows.find((r) => r.id === verdict!.lastId) ?? (sample.sample.length ? sample.sample[sample.sample.length - 1].row : null))
    : null;
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

  // Only the frozen control is ever shown: a nightly one would compare other populations.
  const keptControl = verdict ? { median: verdict.controlMedian, p95: verdict.controlP95, runs: verdict.runs } : null;

  const sampleHolds = sample.sample.map((s) => s.hold);
  const keptProgress = {
    n: sample.sample.length,
    closed: sampleHolds.filter((o) => o.status === "closed").length,
    meanR: summarize(sampleHolds).meanR,
    target: SCORECARD_VERDICT_N,
  };

  const cumulativeR = {} as LiveSnapshot["cumulativeR"];
  for (const g of statsGroups) cumulativeR[g] = cumulative(rows.filter((r) => statsGroupOf(r) === g).map((r) => ({ id: r.id, hold: holdOf(r) })));

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
  // A ran/no_session row, else a failed row (even with partly logged setups), else orphan
  // rows (the setups were logged, only the run row is missing), else nothing ran.
  if (okRun) {
    status = okRun.status as "ran" | "no_session";
    ranAt = okRun.ranAt.toISOString();
  } else if (failedRun) {
    status = "failed";
    ranAt = failedRun.ranAt.toISOString();
    error = failedRun.error ?? null;
  } else if (lastRows.length) {
    status = "ran";
    ranAt = lastRows[0].createdAt.toISOString();
  }
  const lastRun: LastRunSummary = {
    sessionDate,
    status,
    ranAt,
    error,
    setups: lastRows.length,
    ...lastCounts,
    // Vetoed rows also carry a null aiReading, so "no reading" alone would call a veto an outage.
    aiDown: lastRows.length > 0 && lastCounts.unread === lastRows.length,
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
    verdictPending,
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
