// Market regime, computed from the same pinned bar cache the research folds
// read — so a regime gate can be measured on the exact folds every strategy is
// measured on, with no second data source and no second window policy to argue
// about.
//
// Three features, all trailing, all readable at the close of the session they
// are stamped on:
//   - benchmark trend: SPY close vs its own SMA200
//   - breadth:         share of panel names above their own SMA200
//   - realized vol:    SPY 20-day close-to-close volatility, annualized
//
// VIX is deliberately absent. It is not in the cache, so using it would mean a
// second provider with its own window and its own fetchedAt — the fault
// docs/PROPOSAL-panel-validation.md §1c was written about, reintroduced one
// level up. Realized vol is a trailing proxy computed from the same bars as
// everything else, and it is a proxy: it lags the jump VIX prices in.
//
// SURVIVORSHIP: breadth is computed over TODAY's index membership, so names
// that were delisted are absent and breadth reads high in exactly the stretches
// where the real index was losing members. Same bias PANEL_SURVIVORSHIP_CAVEAT
// describes — but unlike a strategy's avgR it has no matched control to cancel
// it. Treat a breadth threshold as a ranking within this cache, never as a
// number that would mean the same thing on live data.
//
// Pure: no fs, no network, no prisma. The caller passes the bars map.

import { sma, type Candle } from "@/lib/indicators";

/** The index proxy. Present in .cache/bars/sp500-1d.json alongside the 491 members. */
export const BENCHMARK = "SPY";

/** Trend lookback for the benchmark and for the breadth count. 200d is the
 *  convention, chosen for being conventional rather than fitted here — the
 *  point is that no part of this was tuned before it was measured. */
export const TREND_PERIOD = 200;

/** Realized-vol lookback, in sessions. */
export const VOL_PERIOD = 20;

const TRADING_DAYS = 252;

/** One session's market state. Every derived field is null until it has enough history. */
export interface RegimeBar {
  /** epoch seconds, the benchmark's session */
  t: number;
  benchClose: number;
  benchSma: number | null;
  /** benchmark above its own SMA200 at this close */
  benchAbove: boolean | null;
  /** 0..1, share of members above their own SMA200; null when no member qualifies yet */
  breadth: number | null;
  /** members holding TREND_PERIOD bars of history that session — breadth's denominator */
  breadthN: number;
  /** annualized, as a fraction (0.18 = 18%) */
  realizedVol: number | null;
}

export interface RegimeSeries {
  benchmark: string;
  /** ascending by `t` */
  bars: RegimeBar[];
}

/**
 * Build the regime series on the benchmark's own session calendar.
 *
 * Throws when the benchmark is missing rather than returning an all-null
 * series: a gate reading null everywhere does not fail, it silently stops
 * gating, which is the most expensive way for this to break.
 */
export function buildRegimeSeries(
  bars: Record<string, Candle[]>,
  benchmark: string = BENCHMARK,
): RegimeSeries {
  const bench = bars[benchmark];
  if (!bench?.length) {
    throw new Error(
      `regime benchmark "${benchmark}" is not in the bar map (${Object.keys(bars).length} symbols) — ` +
        `rebuild the cache with scripts/cache-daily-bars.mts, which includes it`,
    );
  }

  const benchSma = sma(bench.map((b) => b.c), TREND_PERIOD);
  const vol = realizedVol(bench, VOL_PERIOD);

  // Breadth accumulates per session rather than per symbol, because symbols do
  // not share a bar count: a name that listed in 2019 contributes to no session
  // before it. Keying on the timestamp drops a halted session out of the
  // denominator too, which is what breadthN is there to expose.
  const above = new Map<number, number>();
  const total = new Map<number, number>();
  for (const symbol of Object.keys(bars)) {
    if (symbol === benchmark) continue; // the index is not one of its own members
    const rows = bars[symbol];
    if (!rows?.length) continue;
    const s = sma(rows.map((b) => b.c), TREND_PERIOD);
    for (let i = 0; i < rows.length; i++) {
      const ma = s[i];
      if (ma == null) continue;
      const t = rows[i].t;
      total.set(t, (total.get(t) ?? 0) + 1);
      if (rows[i].c > ma) above.set(t, (above.get(t) ?? 0) + 1);
    }
  }

  const out: RegimeBar[] = bench.map((b, i) => {
    const n = total.get(b.t) ?? 0;
    const ma = benchSma[i];
    return {
      t: b.t,
      benchClose: b.c,
      benchSma: ma,
      benchAbove: ma == null ? null : b.c > ma,
      breadth: n ? (above.get(b.t) ?? 0) / n : null,
      breadthN: n,
      realizedVol: vol[i],
    };
  });

  out.sort((a, b) => a.t - b.t);
  return { benchmark, bars: out };
}

/** Annualized close-to-close volatility over a trailing window of `period` returns. */
export function realizedVol(candles: Candle[], period = VOL_PERIOD): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;

  const rets: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    // A zero or negative close is bad data, not a -100% return. A null gap costs
    // one window; letting Math.log(0) through poisons every window touching it.
    rets[i] = prev > 0 && candles[i].c > 0 ? Math.log(candles[i].c / prev) : null;
  }

  for (let i = period; i < candles.length; i++) {
    const w = rets.slice(i - period + 1, i + 1).filter((r): r is number => r != null);
    if (w.length < period) continue;
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    // Sample variance (n-1): the window is a sample of the return process, not
    // the whole of it.
    const varr = w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1);
    out[i] = Math.sqrt(varr * TRADING_DAYS);
  }
  return out;
}

/**
 * The regime as of the close of `t`, never after it.
 *
 * Returns the bar stamped exactly on `t`, or the most recent one before it. A
 * member trading a session the benchmark did not — or a timestamp shifted by a
 * provider's daylight-saving handling — must read yesterday's regime. It must
 * never read tomorrow's, which is how a gate scores a spectacular backtest and
 * nothing else.
 */
export function regimeAt(series: RegimeSeries, t: number): RegimeBar | null {
  const bars = series.bars;
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans < 0 ? null : bars[ans];
}

export type RegimeLabel = "risk-on" | "neutral" | "risk-off" | "unknown";

/**
 * Where the cut points go.
 *
 * Deliberately a parameter with NO exported default. A default here would be a
 * threshold that arrived before the measurement justifying it, and the 13
 * rejected confluence filters are what that looks like at the end. The sweep
 * script supplies a grid; a calibrated set gets exported from here only once it
 * has cleared the TEST folds.
 */
export interface RegimeThresholds {
  /** breadth at or above this, with the benchmark above its SMA200 -> risk-on */
  breadthOn: number;
  /** breadth below this -> risk-off, whatever the benchmark is doing */
  breadthOff: number;
  /** realized vol at or above this -> risk-off regardless of breadth; null disables the vol leg */
  volOff: number | null;
}

/**
 * Label one session. Fails to "unknown", not to "risk-on" — a bar without
 * enough history to have a trend has not been checked and cleared, it has not
 * been checked.
 */
export function labelRegime(bar: RegimeBar | null, th: RegimeThresholds): RegimeLabel {
  if (!bar || bar.breadth == null || bar.benchAbove == null) return "unknown";
  if (th.volOff != null && bar.realizedVol != null && bar.realizedVol >= th.volOff) return "risk-off";
  if (bar.breadth < th.breadthOff) return "risk-off";
  if (bar.breadth >= th.breadthOn && bar.benchAbove) return "risk-on";
  return "neutral";
}
