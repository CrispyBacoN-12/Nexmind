// Sweeps the cross-sectional grid on a chronological 65/35 train/test split and
// prints, for every combo that clears the train bar, its untouched TEST metrics
// beside its train ones. Same protocol as scripts/sweep-*.mts on gold.
//
// Usage: node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts [universe] [pit:y|n]
import { readFile } from "node:fs/promises";
import { crossSectionalBacktest } from "@/lib/backtest/crossSectional/engine";
import { summarizeCrossSectional } from "@/lib/backtest/crossSectional/summary";
import type { CsConfig, CsSummary, FallMeasure, RegimeMode } from "@/lib/backtest/crossSectional/types";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";

const universeKey = process.argv[2] ?? "sp500";
const pit = process.argv[3] === "y";
const TRAIN_FRACTION = 0.65;

const raw = JSON.parse(await readFile(`.cache/bars/${universeKey}-1d.json`, "utf8")) as {
  fetchedAt: string;
  bars: Record<string, Candle[]>;
};
console.log(`loaded ${Object.keys(raw.bars).length} symbols from cache (fetched ${raw.fetchedAt})`);

const isMember = pit
  ? buildMembershipIndex(parseMembershipCsv(await readFile(".cache/sp500-membership.csv", "utf8")))
  : undefined;
if (pit) console.log("point-in-time membership gate: ON (.cache/sp500-membership.csv)");

// Split on a shared date, not per-symbol bar counts, so every symbol's train and
// test windows cover the same calendar period.
const uniqueTimes = [...new Set(Object.values(raw.bars).flatMap((b) => b.map((c) => c.t)))].sort((a, b) => a - b);
const cutoff = uniqueTimes[Math.floor(uniqueTimes.length * TRAIN_FRACTION)];
console.log(`split at ${new Date(cutoff * 1000).toISOString().slice(0, 10)}`);

// `isEligible` refuses every index below 200 (the SMA200 warm-up), so handing the
// engine a bare slice would kill the first 200 trading days of EVERY window — the
// test half would lose ~200 of its ~530 days, and gate 1 would fail for reasons
// that have nothing to do with the edge. Each window therefore carries a warm-up
// prefix taken from before its start. Exactly 200 bars, not more: at that length
// the prefix is entirely ineligible, so it warms the indicators without
// generating a single trade of its own.
const WARMUP_BARS = 200;

/** Bars from `fromT` (inclusive) to `toT` (exclusive), preceded by the warm-up prefix. */
function window(fromT: number | null, toT: number | null): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [sym, candles] of Object.entries(raw.bars)) {
    let start = 0;
    if (fromT != null) {
      const at = candles.findIndex((c) => c.t >= fromT);
      if (at === -1) continue; // symbol stopped trading before this window opens
      start = Math.max(0, at - WARMUP_BARS);
    }
    const endAt = toT == null ? -1 : candles.findIndex((c) => c.t >= toT);
    const part = candles.slice(start, endAt === -1 ? candles.length : endAt);
    if (part.length) out.set(sym, part);
  }
  return out;
}

/**
 * Run one window and summarise only the part inside it: trades entered during the
 * warm-up prefix and equity points before `windowStart` are dropped, so drawdown,
 * CAGR and time-in-market describe the window itself rather than the prefix.
 */
function runWindow(bars: Map<string, Candle[]>, cfg: CsConfig, windowStart: number): CsSummary {
  const res = crossSectionalBacktest(bars, cfg, isMember);
  const trades = res.trades.filter((t) => t.entryT >= windowStart);
  const curve = res.equityCurve.filter((p) => p.t >= windowStart);
  if (!curve.length) return summarizeCrossSectional(trades, [], cfg.capital);
  // Rebase to the window's own opening equity so a drawdown is measured against
  // the capital the window actually started with.
  const base = curve[0].equity;
  const scale = base > 0 ? cfg.capital / base : 1;
  return summarizeCrossSectional(trades, curve.map((p) => ({ ...p, equity: p.equity * scale })), cfg.capital);
}

// The train window has no pre-history to borrow, so its own first WARMUP_BARS days
// are genuinely untradable — nobody can trade before their indicators exist.
const trainBars = window(null, cutoff);
const trainStart = uniqueTimes[WARMUP_BARS];
const testBars = window(cutoff, null);
console.log(
  `train from ${new Date(trainStart * 1000).toISOString().slice(0, 10)}, test from cutoff` +
  ` (each window warmed by ${WARMUP_BARS} prior bars)`,
);

const BASE: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: true, regime: "spySma200", maxSingleDayMovePct: 15,
  slots: 5, holdDays: 5, exitOnSma5: false, stopAtrMult: null,
  costs: DEFAULT_COST_MODEL, capital: 10_000, regimeSymbol: "SPY",
};

const GRID = {
  measure: ["atrReturn", "rsi2"] as FallMeasure[],
  lookback: [2, 3, 5],
  requireAboveSma200: [true, false],
  regime: ["off", "spySma200", "spySlope"] as RegimeMode[],
  slots: [3, 5, 10],
  holdDays: [3, 5, 10],
  stopAtrMult: [null, 2, 3],
};

const combos: CsConfig[] = [];
for (const measure of GRID.measure)
  for (const lookback of GRID.lookback)
    for (const requireAboveSma200 of GRID.requireAboveSma200)
      for (const regime of GRID.regime)
        for (const slots of GRID.slots)
          for (const holdDays of GRID.holdDays)
            for (const stopAtrMult of GRID.stopAtrMult) {
              // lookback is meaningless for rsi2; keep one representative to avoid duplicates.
              if (measure === "rsi2" && lookback !== GRID.lookback[0]) continue;
              // The two measures live on different scales: atrReturn is negative
              // when a stock has fallen, RSI(2) is a 0-100 level. A single
              // threshold would silently admit everything under one and nothing
              // under the other.
              const maxRankScore = measure === "rsi2" ? 10 : 0;
              combos.push({ ...BASE, measure, maxRankScore, lookback, requireAboveSma200, regime, slots, holdDays, stopAtrMult });
            }

console.log(`sweeping ${combos.length} combos ...\n`);

const label = (c: CsConfig) =>
  `${c.measure}${c.measure === "atrReturn" ? `/k=${c.lookback}` : ""} sma200=${c.requireAboveSma200 ? "y" : "n"} regime=${c.regime} slots=${c.slots} hold=${c.holdDays} stop=${c.stopAtrMult ?? "off"}`;

const rows: { label: string; train: CsSummary; test: CsSummary }[] = [];
for (const combo of combos) {
  const train = runWindow(trainBars, combo, trainStart);
  // Train bar: a real edge must be clearly profitable in-sample AND have enough
  // trades to mean anything. 500 is gate 1 from the spec.
  if (train.trades < 500 || (train.profitFactor ?? 0) < 1.1) continue;
  const test = runWindow(testBars, combo, cutoff);
  rows.push({ label: label(combo), train, test });
}

rows.sort((a, b) => (b.test.profitFactor ?? 0) - (a.test.profitFactor ?? 0));

console.log(`${rows.length}/${combos.length} combos passed the train bar\n`);
console.log("params".padEnd(62), "trainPF  testPF  testTrades  testRet%  testDD%  inMkt%");
for (const r of rows) {
  console.log(
    r.label.padEnd(62),
    (r.train.profitFactor ?? 0).toFixed(2).padStart(7),
    (r.test.profitFactor ?? 0).toFixed(2).padStart(7),
    String(r.test.trades).padStart(11),
    (r.test.avgRetPct ?? 0).toFixed(3).padStart(9),
    (r.test.maxDrawdownPct ?? 0).toFixed(1).padStart(8),
    r.test.timeInMarketPct.toFixed(0).padStart(7),
  );
}

// Failure-mode diagnostic, same as the gold sweeps: distinguish "no combo made
// enough trades" from "plenty of trades, no edge".
if (!rows.length) {
  const sample = runWindow(trainBars, BASE, trainStart);
  console.log(`\nno combo passed. baseline train: ${sample.trades} trades over ${sample.tradingDays} days, PF ${(sample.profitFactor ?? 0).toFixed(2)}`);
  console.log(sample.trades < 500 ? "→ TRADE STARVATION: loosen filters or shorten holdDays" : "→ NO EDGE: the mechanism does not work here");
}
