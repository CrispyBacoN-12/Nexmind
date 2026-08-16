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
  /**
   * Selected symbols with no return to report: either no bar ever arrived on
   * or after the fill day (delisted at the ranking bar itself), or the
   * fallback exit collapsed onto the fill bar (the symbol's last bar was
   * already its fill). Both leave nothing measurable, so the symbol is left
   * out of every snapshot rather than assigned a fabricated return — this
   * counts how often that happened so a run with many of them is visible
   * instead of silently reporting `substitutions = 0` and looking clean.
   */
  unfillable: number;
}

export function buildSnapshots(bars: Map<string, Candle[]>, cfg: MomentumConfig): StudyOutput {
  const { days, index } = alignUniverse(bars);
  const ends = monthEndIndices(days);
  const snapshots: Snapshot[] = [];
  let substitutions = 0;
  let unfillable = 0;

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
      // knowable at the ranking date. A selected symbol whose bars merely stop
      // early is not dropped — it exits at its last open, because dropping it
      // retroactively is the survivorship mechanism this study exists to avoid.
      //
      // Two cases leave nothing to measure at all, and both are counted rather
      // than assigned a fabricated return: no bar ever arrives on or after the
      // fill day, and a fallback exit that lands on the fill bar itself.
      const fill = barAtOrAfter(perDay, days, fillIdx);
      if (fill === null) {
        unfillable++;
        continue; // no fill ever happened; there is no trade
      }
      const exact = barAtOrAfter(perDay, days, exitFillIdx);
      // Bars stopped before the exit day: exit at the last available open.
      const exit = exact ?? candles.length - 1;
      if (exit <= fill) {
        unfillable++;
        continue;
      }

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

  return { snapshots, substitutions, unfillable };
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
  // Failing open here would be a lookahead, not an inconvenience: a missing
  // cutoff gives end = -1, and slice(0, -1) is the whole history bar one day.
  if (end < 0) throw new Error(`beforeDay ${beforeDay} is not a union calendar day`);
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
