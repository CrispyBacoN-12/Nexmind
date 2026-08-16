// The one pass over bars. Everything downstream — both legs, the mega-cap
// subset, and all 1,000 permutation iterations — is arithmetic over the
// snapshots this produces, so the expensive work happens exactly once.
import { alignUniverse, dayKey } from "@/lib/backtest/crossSectional/calendar";
import type { Candle } from "@/lib/indicators";
import { monthEndIndices } from "./monthEnds";
import { momentumScores } from "./scores";
import type { MomentumConfig, Snapshot } from "./types";

/** The symbol's first bar on or after union-day index `from`, or null. */
function barAtOrAfter(perDay: Map<number, number>, days: number[], from: number): number | null {
  for (let d = from; d < days.length; d++) {
    const i = perDay.get(days[d]);
    if (i !== undefined) return i;
  }
  return null;
}

export interface StudyOutput {
  snapshots: Snapshot[];
  /** Selections whose fill or exit bar was not the intended union day. */
  substitutions: number;
}

export function buildSnapshots(bars: Map<string, Candle[]>, cfg: MomentumConfig): StudyOutput {
  const { days, index } = alignUniverse(bars);
  const ends = monthEndIndices(days);
  const snapshots: Snapshot[] = [];
  let substitutions = 0;

  // Each rebalance needs the NEXT month end to exit into, so the last flagged
  // month end never opens a position.
  for (let e = 0; e + 1 < ends.length; e++) {
    const rankIdx = ends[e];
    const fillIdx = rankIdx + 1;
    const exitFillIdx = ends[e + 1] + 1;
    if (exitFillIdx >= days.length) break;

    const symbols: string[] = [];
    const raw: number[] = [];
    const volAdj: number[] = [];
    const returns: number[] = [];

    for (const [symbol, candles] of bars) {
      const perDay = index.get(symbol)!;
      const i = perDay.get(days[rankIdx]);
      if (i === undefined) continue;

      // Selection happens here, on data no later than the ranking day.
      const score = momentumScores(candles, i, cfg.lookback, cfg.skip);
      if (score === null) continue;

      // Fill and exit are resolved only after selection, because neither is
      // knowable at the ranking date. A selected symbol is never dropped for
      // what happens after — dropping it retroactively is the survivorship
      // mechanism this study exists to avoid.
      const fill = barAtOrAfter(perDay, days, fillIdx);
      if (fill === null) continue; // no fill ever happened; there is no trade
      const exact = barAtOrAfter(perDay, days, exitFillIdx);
      // Bars stopped before the exit day: exit at the last available open.
      const exit = exact ?? candles.length - 1;
      if (exit <= fill) continue;

      if (dayKey(candles[fill].t) !== days[fillIdx] || dayKey(candles[exit].t) !== days[exitFillIdx]) {
        substitutions++;
      }

      symbols.push(symbol);
      raw.push(score.raw);
      volAdj.push(score.volAdj);
      returns.push(candles[exit].o / candles[fill].o - 1);
    }

    if (symbols.length < cfg.minEligible) continue;
    snapshots.push({ day: days[rankIdx], symbols, scores: { raw, volAdj }, returns });
  }

  return { snapshots, substitutions };
}

/**
 * The `count` symbols with the highest median dollar volume over the `window`
 * union days ending immediately BEFORE `beforeDay`. The window closes before
 * the first ranking, so membership is fixed for the whole study and introduces
 * no lookahead — which is the entire point of the mega-cap gate.
 */
export function topByDollarVolume(
  bars: Map<string, Candle[]>,
  days: number[],
  beforeDay: number,
  window: number,
  count: number,
): Set<string> {
  const end = days.indexOf(beforeDay);
  const lo = Math.max(0, end - window);
  const wanted = new Set(days.slice(lo, end));

  const scored: Array<[string, number]> = [];
  for (const [symbol, candles] of bars) {
    const dv: number[] = [];
    for (const c of candles) if (wanted.has(dayKey(c.t))) dv.push(c.c * c.v);
    if (dv.length === 0) continue;
    dv.sort((a, b) => a - b);
    const mid = dv.length >> 1;
    scored.push([symbol, dv.length % 2 === 1 ? dv[mid] : (dv[mid - 1] + dv[mid]) / 2]);
  }

  scored.sort((a, b) => b[1] - a[1]);
  return new Set(scored.slice(0, count).map(([s]) => s));
}

export function subsetBars(bars: Map<string, Candle[]>, keep: Set<string>): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [symbol, candles] of bars) if (keep.has(symbol)) out.set(symbol, candles);
  return out;
}
