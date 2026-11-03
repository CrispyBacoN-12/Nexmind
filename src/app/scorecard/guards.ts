// Runtime shape checks for the stored scorecard snapshots. The page reads Json columns, so
// an older or partial snapshot would otherwise crash it. A snapshot that fails its guard is
// treated as "old shape" and the page shows a placeholder instead.
//
// Pure. The imports are types only (nightly.ts / replay.ts reach prisma). Each guard checks
// every field the page dereferences.

import type { GroupStats } from "@/lib/scorecard/groups";
import type { AiVerdict, LiveSnapshot, RecentTrade } from "@/lib/scorecard/nightly";
import type { ReplaySummary } from "@/lib/scorecard/replay";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const isArrayOf = <T>(v: unknown, f: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(f);
const hasNums = (o: Obj, keys: string[]) => keys.every((k) => isNum(o[k]));

function isGroupStats(v: unknown): v is GroupStats {
  return isObj(v) && isNum(v.n) && isNumOrNull(v.meanR) && isNumOrNull(v.winPct) && isNumOrNull(v.t1Pct);
}

function isVariantStats(v: unknown): v is { hold: GroupStats; sameDay: GroupStats } {
  return isObj(v) && isGroupStats(v.hold) && isGroupStats(v.sameDay);
}

function isCounts(v: unknown): boolean {
  return isObj(v) && hasNums(v, ["total", "filled", "closed", "open", "notFilled", "noData"]);
}

function isControl(v: unknown): v is { median: number; p95: number; runs: number } {
  return isObj(v) && hasNums(v, ["median", "p95", "runs"]);
}

function isModelMix(v: unknown): v is Record<string, number> {
  return isObj(v) && Object.values(v).every(isNum);
}

function isPoint(v: unknown): v is { date: string; cumR: number; n: number } {
  return isObj(v) && isStr(v.date) && isNum(v.cumR) && isNum(v.n);
}

const GROUPS = ["kept", "vetoed", "stripped", "unread", "afterVerdict"] as const;
const TRADE_GROUPS = ["kept", "vetoed", "stripped", "unread"];
const OUTCOME_STATUSES = ["open", "closed", "not_filled", "no_data"];

function isRecentTrade(v: unknown): v is RecentTrade {
  if (!isObj(v) || !isNum(v.id) || !isStr(v.date) || !isStr(v.ticker)) return false;
  if (!isStr(v.group) || !TRADE_GROUPS.includes(v.group)) return false;
  if (!isNumOrNull(v.fill) || !isNum(v.stop) || !isNum(v.t1)) return false;
  const h = v.hold;
  return isObj(h) && isStr(h.status) && OUTCOME_STATUSES.includes(h.status) && isNumOrNull(h.r) && isStrOrNull(h.reason) && isNum(h.sessionsHeld);
}

function isLastRun(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.sessionDate) &&
    isStr(v.status) &&
    isStrOrNull(v.error) &&
    hasNums(v, ["setups", "kept", "vetoed", "stripped", "unread"]) &&
    typeof v.aiDown === "boolean"
  );
}

export function isAiVerdict(v: unknown): v is AiVerdict {
  return (
    isObj(v) &&
    hasNums(v, ["n", "meanR", "controlMedian", "controlP95", "runs", "firstId", "lastId"]) &&
    typeof v.pass === "boolean" &&
    isStr(v.computedAt) &&
    isModelMix(v.modelMix)
  );
}

export function isReplaySummary(v: unknown): v is ReplaySummary {
  return (
    isObj(v) &&
    isObj(v.period) &&
    isStr(v.period.from) &&
    isStr(v.period.to) &&
    hasNums(v, ["sessions", "universe", "tickersWithData", "setupsFound", "filled", "notFilled", "open"]) &&
    // Added after the first replay shape; optional so an older snapshot still renders.
    (v.tailSessionsExcluded === undefined || isNum(v.tailSessionsExcluded)) &&
    Array.isArray(v.missingTickers) &&
    isVariantStats(v.stats) &&
    (v.control === null || isControl(v.control)) &&
    typeof v.pass === "boolean" &&
    isArrayOf(v.biases, isStr)
  );
}

export function isLiveSnapshot(v: unknown): v is LiveSnapshot {
  if (!isObj(v) || !isStr(v.computedAt) || !isStr(v.sessionDate)) return false;
  if (!isObj(v.stats) || !isObj(v.counts) || !isObj(v.cumulativeR)) return false;
  for (const g of GROUPS) {
    if (!isVariantStats(v.stats[g]) || !isCounts(v.counts[g]) || !isArrayOf(v.cumulativeR[g], isPoint)) return false;
  }
  if (!(v.keptControl === null || isControl(v.keptControl))) return false;
  const p = v.keptProgress;
  if (!isObj(p) || !hasNums(p, ["n", "closed", "target"]) || !isNumOrNull(p.meanR) || (p.target as number) <= 0) return false;
  if (!isModelMix(v.modelMix) || !isLastRun(v.lastRun)) return false;
  if (!isArrayOf(v.missed, (m): m is { date: string; failed: string | null } => isObj(m) && isStr(m.date) && isStrOrNull(m.failed))) return false;
  if (!isArrayOf(v.recentTrades, isRecentTrade)) return false;
  // Added after the first live shape; optional so an older snapshot still renders.
  if (!(v.verdictPending === undefined || isStrOrNull(v.verdictPending))) return false;
  return v.verdict == null || isAiVerdict(v.verdict);
}
