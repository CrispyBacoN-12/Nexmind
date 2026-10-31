// The long liquidity-sweep setup rule of the chart agent (spec §5). It turns
// levels plus today's 5-minute bars into entry, stop and two targets with R,
// or a Thai reason why there is none. The owner sizes real trades from this
// stop, so every number is computed here and the steps run in a fixed order:
// the first one that fails decides the reason.

import {
  CHART_BAR_SECONDS,
  CHART_LEVEL_MERGE_ATR,
  CHART_MIN_T1_R,
  CHART_STOP_BUFFER_ATR,
} from "./types";
import type {
  LevelName,
  Levels,
  SessionSplit,
  Setup,
  SetupOutcome,
  Target,
} from "./types";

const SWEEP_LEVELS: LevelName[] = ["PDL", "PML", "pVAL"];
const TARGET_LEVELS: LevelName[] = ["dPOC", "pPOC", "pVAH", "PDH", "PMH"];

/** Levels merged into one target, priced at the lowest of them. */
interface Group {
  price: number;
  names: LevelName[];
}

function none(ticker: string, reason: string): SetupOutcome {
  return { kind: "none", ticker, reason };
}

/** Candidates above `entry`, ascending, merged when within the merge distance of the group's lower price. */
function targetGroups(levels: Levels, entry: number, atrDaily: number): Group[] {
  const above: Group[] = [];
  for (const name of TARGET_LEVELS) {
    const price = levels[name];
    if (price !== null && price > entry) above.push({ price, names: [name] });
  }
  above.sort((a, b) => a.price - b.price);

  const groups: Group[] = [];
  for (const cand of above) {
    const group = groups.at(-1);
    if (group && cand.price - group.price <= CHART_LEVEL_MERGE_ATR * atrDaily) {
      group.names.push(...cand.names);
    } else {
      groups.push(cand);
    }
  }
  return groups;
}

export function findSetup(
  ticker: string,
  split: SessionSplit,
  levels: Levels,
  atrDaily: number,
): SetupOutcome {
  const { regular } = split;

  // 1. Something to read, and an ATR to size the buffers with.
  if (regular.length === 0) return none(ticker, "ยังไม่มีแท่งในเวลาทำการ");
  if (!Number.isFinite(atrDaily) || atrDaily <= 0) {
    return none(ticker, "ATR คำนวณไม่ได้");
  }

  // 2. Most recent bar that came from above a level (opened above it), pierced
  // it and closed back above it, while the latest close is still above that
  // level. A bar that opens below and closes above is a reclaim, not a sweep.
  const last = regular[regular.length - 1];
  let sweepIdx = -1;
  let sweptLevels: LevelName[] = [];
  for (let i = regular.length - 1; i >= 0; i--) {
    const b = regular[i];
    const hit = SWEEP_LEVELS.filter((name) => {
      const L = levels[name];
      return L !== null && b.o > L && b.l < L && b.c > L && last.c > L;
    });
    if (hit.length > 0) {
      sweepIdx = i;
      sweptLevels = hit;
      break;
    }
  }
  if (sweepIdx < 0) return none(ticker, "ยังไม่มี sweep");
  const sweepBar = regular[sweepIdx];
  const after = regular.slice(sweepIdx + 1);

  // 3. Stop under the sweep low, entry at the latest close.
  const stop = sweepBar.l - CHART_STOP_BUFFER_ATR * atrDaily;
  const entry = last.c;

  // 4. The sweep low must still hold on closes.
  if (after.some((b) => b.c < sweepBar.l)) {
    return none(ticker, "หลุด low ของแท่ง sweep แล้ว");
  }

  // 5. Targets above the price, near ones merged.
  const groups = targetGroups(levels, entry, atrDaily);
  if (groups.length === 0) return none(ticker, "ไม่มีระดับเหนือราคา");

  // 6. The first target must not have traded already.
  if (after.some((b) => b.h >= groups[0].price)) {
    return none(ticker, "ถึงเป้าแรกไปแล้ว");
  }

  // 7. R of each target against the stop distance.
  const risk = entry - stop;
  const toTarget = (g: Group): Target => ({
    price: g.price,
    names: g.names,
    r: (g.price - entry) / risk,
  });
  const t1 = toTarget(groups[0]);
  const t2 = groups.length > 1 ? toTarget(groups[1]) : null;
  const tags = t1.r < CHART_MIN_T1_R ? ["เป้าแรกไม่ถึง 1.5R"] : [];

  // 8. The data is as new as the end of the last bar.
  const dataAsOf = new Date((last.t + CHART_BAR_SECONDS) * 1000).toISOString();

  const setup: Setup = {
    ticker,
    entry,
    stop,
    t1,
    t2,
    sweptLevels,
    sweepBar,
    tags,
    levels,
    dataAsOf,
  };
  return { kind: "setup", setup };
}
