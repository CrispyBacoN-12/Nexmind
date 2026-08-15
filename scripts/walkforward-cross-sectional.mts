// Scores one config against the spec's acceptance gates: 6-block walk-forward,
// 3x cost stress, universe haircut, and the SPY benchmark. Gates 1-3 and 5-7 are
// mechanical here; gate 4 (parameter plateau) is read off the Task 6 sweep table.
//
// Usage: node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts \
//          [universe] [measure] [lookback] [regime] [slots] [holdDays] [stop|off] [sma200:y|n]
import { readFile } from "node:fs/promises";
import { crossSectionalBacktest } from "@/lib/backtest/crossSectional/engine";
import { summarizeCrossSectional } from "@/lib/backtest/crossSectional/summary";
import type { CsConfig, CsSummary, FallMeasure, RegimeMode } from "@/lib/backtest/crossSectional/types";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

const BLOCKS = 6;

const [, , universeKey = "sp500", measure = "atrReturn", lookback = "3", regime = "spySma200",
  slots = "5", holdDays = "5", stop = "off", sma200 = "y"] = process.argv;

async function loadBars(key: string): Promise<Map<string, Candle[]>> {
  const raw = JSON.parse(await readFile(`.cache/bars/${key}-1d.json`, "utf8")) as { bars: Record<string, Candle[]> };
  return new Map(Object.entries(raw.bars));
}

const cfg: CsConfig = {
  measure: measure as FallMeasure,
  maxRankScore: measure === "rsi2" ? 10 : 0,
  lookback: Number(lookback),
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: sma200 === "y",
  regime: regime as RegimeMode,
  maxSingleDayMovePct: 15,
  slots: Number(slots),
  holdDays: Number(holdDays),
  exitOnSma5: false,
  stopAtrMult: stop === "off" ? null : Number(stop),
  costs: DEFAULT_COST_MODEL,
  capital: 10_000,
  regimeSymbol: "SPY",
};

const bars = await loadBars(universeKey);
console.log(`config: ${JSON.stringify({ ...cfg, costs: undefined })}\n`);

// `isEligible` refuses every index below 200 (the SMA200 warm-up), so a bare window
// slice would kill its own first 200 trading days. The blocks below are only ~220
// days long, so bare slicing would leave ~20 usable days each and gates 2-3 would
// fail for reasons that have nothing to do with the edge. Every window therefore
// carries a warm-up prefix of exactly 200 bars: long enough to warm each indicator,
// short enough that the prefix is wholly ineligible and adds no trades of its own.
const WARMUP_BARS = 200;

function windowBars(all: Map<string, Candle[]>, from: number, to: number): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [sym, candles] of all) {
    const at = candles.findIndex((c) => c.t >= from);
    if (at === -1) continue; // symbol stopped trading before this window opens
    const endAt = candles.findIndex((c) => c.t >= to);
    const part = candles.slice(Math.max(0, at - WARMUP_BARS), endAt === -1 ? candles.length : endAt);
    if (part.length) out.set(sym, part);
  }
  return out;
}

/** Run one window and summarise only the part that falls inside the window itself. */
function runWindow(all: Map<string, Candle[]>, from: number, to: number): CsSummary {
  const res = crossSectionalBacktest(windowBars(all, from, to), cfg);
  const trades = res.trades.filter((t) => t.entryT >= from);
  const curve = res.equityCurve.filter((p) => p.t >= from);
  if (!curve.length) return summarizeCrossSectional(trades, [], cfg.capital);
  // Rebase to the window's own opening equity so a drawdown is measured against the
  // capital this window actually started with.
  const base = curve[0].equity;
  const scale = base > 0 ? cfg.capital / base : 1;
  return summarizeCrossSectional(trades, curve.map((p) => ({ ...p, equity: p.equity * scale })), cfg.capital);
}

const times = [...new Set([...bars.values()].flatMap((b) => b.map((c) => c.t)))].sort((a, b) => a - b);
// Walk forward over the TRADABLE span only. The dataset's first WARMUP_BARS days can
// never produce a trade, and including them would hand block 1 a couple hundred dead
// days that blocks 2-6 do not have, making the blocks incomparable.
const start = times[WARMUP_BARS];
const end = times[times.length - 1];
const span = (end - start) / BLOCKS;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// --- Gates 2 and 3: both halves positive, and 5/6 walk-forward blocks positive ---
console.log("--- walk-forward blocks ---");
let positiveBlocks = 0;
for (let b = 0; b < BLOCKS; b++) {
  const from = start + b * span;
  const to = b === BLOCKS - 1 ? end + 1 : start + (b + 1) * span;
  const s = runWindow(bars, from, to);
  const positive = s.totalPnl > 0;
  if (positive) positiveBlocks++;
  console.log(
    `${iso(from)}..${iso(to)}`.padEnd(26),
    `trades=${String(s.trades).padStart(5)}`,
    `PF=${(s.profitFactor ?? 0).toFixed(2)}`,
    `pnl=${s.totalPnl.toFixed(0).padStart(8)}`,
    `DD=${(s.maxDrawdownPct ?? 0).toFixed(1)}%`,
    positive ? "+" : "-",
  );
}

const mid = start + (end - start) * 0.65;
const trainS = runWindow(bars, start, mid);
const testS = runWindow(bars, mid, end + 1);

// --- Gate 5: 3x cost stress ---
const stressed = crossSectionalBacktest(bars, {
  ...cfg,
  costs: { slippageBps: (DEFAULT_COST_MODEL.slippageBps ?? 0) * 3, commissionBps: (DEFAULT_COST_MODEL.commissionBps ?? 0) * 3 },
}).summary;

// --- Gate 6: universe haircut ---
console.log("\n--- universe haircut (narrower list = more survivorship bias) ---");
const haircut: Record<string, number> = {};
for (const key of ["dow30", "nasdaq100", "sp500"]) {
  try {
    const s = crossSectionalBacktest(await loadBars(key), cfg).summary;
    haircut[key] = s.profitFactor ?? 0;
    console.log(`${key.padEnd(12)} PF=${(s.profitFactor ?? 0).toFixed(2)} trades=${s.trades}`);
  } catch {
    console.log(`${key.padEnd(12)} (no cache — run cache-daily-bars.mts for this universe)`);
  }
}

// --- Gate 7: SPY benchmark, return per unit of max drawdown ---
const full = crossSectionalBacktest(bars, cfg).summary;
const spy = bars.get("SPY") ?? [];
let spyReturnPct = 0;
let spyMaxDdPct = 0;
if (spy.length) {
  spyReturnPct = ((spy[spy.length - 1].c - spy[0].c) / spy[0].c) * 100;
  let peak = spy[0].c;
  for (const c of spy) {
    peak = Math.max(peak, c.c);
    spyMaxDdPct = Math.max(spyMaxDdPct, ((peak - c.c) / peak) * 100);
  }
}
const stratReturnPct = ((full.totalPnl) / cfg.capital) * 100;
const stratRatio = full.maxDrawdownPct ? stratReturnPct / full.maxDrawdownPct : null;
const spyRatio = spyMaxDdPct ? spyReturnPct / spyMaxDdPct : null;

// --- Scorecard ---
const gates: [string, boolean, string][] = [
  ["1. >=500 trades per half", trainS.trades >= 500 && testS.trades >= 500, `train=${trainS.trades} test=${testS.trades}`],
  ["2. positive in both halves", trainS.totalPnl > 0 && testS.totalPnl > 0, `train=${trainS.totalPnl.toFixed(0)} test=${testS.totalPnl.toFixed(0)}`],
  ["3. >=5/6 walk-forward blocks", positiveBlocks >= 5, `${positiveBlocks}/6`],
  ["4. parameter plateau", false, "MANUAL — read the Task 6 sweep table"],
  ["5. survives 3x costs", stressed.totalPnl > 0, `pnl=${stressed.totalPnl.toFixed(0)}`],
  ["6. no improvement as universe narrows", (haircut.dow30 ?? 0) <= (haircut.sp500 ?? 0), `dow30=${(haircut.dow30 ?? 0).toFixed(2)} sp500=${(haircut.sp500 ?? 0).toFixed(2)}`],
  ["7. beats SPY return/maxDD", stratRatio != null && spyRatio != null && stratRatio > spyRatio, `strat=${stratRatio?.toFixed(2)} spy=${spyRatio?.toFixed(2)}`],
];

console.log("\n--- gate scorecard ---");
for (const [name, pass, detail] of gates) console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
console.log(`\nverdict: ${gates.every(([, p]) => p) ? "ALL GATES PASS" : "FAILED — see above"}`);
