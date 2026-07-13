// Monte Carlo stress testing over a strategy's historical R-multiple sequence.
// A single backtest run shows one equity path; it says nothing about how bad
// luck in trade ORDER or a different-but-similar SAMPLE of outcomes could
// have been. Two resampling methods, both standard in quant risk review:
//
// - shuffle: same trades, reshuffled order. Isolates sequence risk - can a
//   losing streak, purely from unlucky ordering of the same wins/losses,
//   breach the drawdown halt even though total return is unchanged?
// - bootstrap: resample with replacement. Isolates sampling risk - if the
//   live strategy's future trades are a different draw from the same
//   underlying distribution, how wide is the range of plausible outcomes?
//
// Equity compounds by risking riskPctPerTrade of CURRENT equity per trade
// (matches live position sizing - risk % of balance, not a fixed $ amount),
// so simulated drawdown is directly comparable to a portfolio's own
// drawdownHaltPct circuit breaker (see src/lib/trading/circuitBreaker.ts,
// which defines drawdown identically: peak-to-trough % over an equity curve
// seeded at startingBalance).

export interface McConfig {
  startingBalance: number;
  riskPctPerTrade: number; // % of current equity risked per trade
  iterations: number;
}

export interface McRunResult {
  finalEquity: number;
  finalReturnPct: number;
  maxDrawdownPct: number;
  longestLosingStreak: number;
}

export interface McPercentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  worst: number; // worst-case tail (max for drawdown/streak, min for return)
}

export interface McSummary {
  method: "shuffle" | "bootstrap";
  iterations: number;
  tradesPerRun: number;
  maxDrawdownPct: McPercentiles;
  finalReturnPct: McPercentiles;
  longestLosingStreak: McPercentiles;
  probBreach: (haltPct: number) => number; // fraction of runs whose maxDD >= haltPct
}

function simulateOne(rMultiples: number[], cfg: McConfig): McRunResult {
  let equity = cfg.startingBalance;
  let peak = cfg.startingBalance;
  let maxDD = 0;
  let losingStreak = 0;
  let longestStreak = 0;
  for (const r of rMultiples) {
    const riskUsd = equity * (cfg.riskPctPerTrade / 100);
    equity += riskUsd * r;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    if (r < 0) {
      losingStreak++;
      longestStreak = Math.max(longestStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
  }
  return {
    finalEquity: equity,
    finalReturnPct: ((equity - cfg.startingBalance) / cfg.startingBalance) * 100,
    maxDrawdownPct: maxDD,
    longestLosingStreak: longestStreak,
  };
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function summarize(results: McRunResult[], method: "shuffle" | "bootstrap", tradesPerRun: number): McSummary {
  const dds = results.map((r) => r.maxDrawdownPct).sort((a, b) => a - b);
  const rets = results.map((r) => r.finalReturnPct).sort((a, b) => a - b);
  const streaks = results.map((r) => r.longestLosingStreak).sort((a, b) => a - b);
  return {
    method,
    iterations: results.length,
    tradesPerRun,
    maxDrawdownPct: {
      p5: percentile(dds, 0.05), p25: percentile(dds, 0.25), p50: percentile(dds, 0.5),
      p75: percentile(dds, 0.75), p95: percentile(dds, 0.95), worst: dds[dds.length - 1],
    },
    finalReturnPct: {
      p5: percentile(rets, 0.05), p25: percentile(rets, 0.25), p50: percentile(rets, 0.5),
      p75: percentile(rets, 0.75), p95: percentile(rets, 0.95), worst: rets[0],
    },
    longestLosingStreak: {
      p5: percentile(streaks, 0.05), p25: percentile(streaks, 0.25), p50: percentile(streaks, 0.5),
      p75: percentile(streaks, 0.75), p95: percentile(streaks, 0.95), worst: streaks[streaks.length - 1],
    },
    probBreach: (haltPct: number) => dds.filter((d) => d >= haltPct).length / dds.length,
  };
}

/** Reshuffle the same historical trades into random orders. Total return is invariant; only path/drawdown varies. */
export function monteCarloShuffle(rMultiples: number[], cfg: McConfig): McSummary {
  if (rMultiples.length === 0) throw new Error("monteCarloShuffle: no trades to simulate");
  const results: McRunResult[] = [];
  for (let i = 0; i < cfg.iterations; i++) results.push(simulateOne(shuffled(rMultiples), cfg));
  return summarize(results, "shuffle", rMultiples.length);
}

/** Resample trades with replacement. Both order and total return vary - wider, more realistic tail. */
export function monteCarloBootstrap(rMultiples: number[], cfg: McConfig, sampleSize = rMultiples.length): McSummary {
  if (rMultiples.length === 0) throw new Error("monteCarloBootstrap: no trades to simulate");
  const results: McRunResult[] = [];
  for (let i = 0; i < cfg.iterations; i++) {
    const sample: number[] = new Array(sampleSize);
    for (let k = 0; k < sampleSize; k++) sample[k] = rMultiples[Math.floor(Math.random() * rMultiples.length)];
    results.push(simulateOne(sample, cfg));
  }
  return summarize(results, "bootstrap", sampleSize);
}
