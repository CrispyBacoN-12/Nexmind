// One-factor-at-a-time sweep of the confluence filters now wired into
// decideSetup (Bollinger %B / bandwidth, Stochastic, VWAP side, Lorentzian,
// volume-profile value area, liquidity sweep).
//
// Every filter is a veto: it can only delete entries the trend-pullback rule
// already found. So the question is never "does it make more money" (deleting
// trades from a positive-expectancy rule always makes less total money) — it is
// "are the trades it deletes the losing ones", i.e. does expectancy per trade
// rise enough to be worth the lost count.
//
// Run in-sample first, choose from that alone, then confirm the picks
// out-of-sample. Peeking at the OOS table before choosing turns the held-out
// period into just more training data.
//
// Usage:
//   node --env-file=.env --import tsx scripts/setup-filter-sweep.mts --split=is
//   node --env-file=.env --import tsx scripts/setup-filter-sweep.mts --split=oos --only="LC agrees,VWAP side"
//
// Flags: --split=is|oos  --universe=sp500|dow30  --every=N (symbol stride)  --only=label,label

import { readFile } from "node:fs/promises";
import { backtestCandles, barSnapshots, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { DEFAULT_THRESHOLDS, type SetupThresholds } from "@/lib/trading/scanner";
import type { Candle } from "@/lib/indicators";
import type { SimTrade } from "@/lib/backtest/engine";

const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;

const SPLIT = (arg("split", "is") as "is" | "oos");
const UNIVERSE = arg("universe", "sp500")!;
const STRIDE = Number(arg("every", "3"));
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);

// The held-out period. Chosen once, by calendar, before any result was seen —
// not tuned to make a number look good.
const CUT = Date.UTC(2023, 0, 1) / 1000;
const LEAD_IN = 300; // bars of history the OOS slice needs before its first tradable bar

const VARIANTS: Array<{ label: string; t: SetupThresholds }> = [
  { label: "baseline", t: DEFAULT_THRESHOLDS },
  { label: "BB %B < 0.90", t: { ...DEFAULT_THRESHOLDS, bbExtreme: 0.9 } },
  { label: "BB %B < 0.80", t: { ...DEFAULT_THRESHOLDS, bbExtreme: 0.8 } },
  { label: "BB %B < 0.70", t: { ...DEFAULT_THRESHOLDS, bbExtreme: 0.7 } },
  { label: "BB width > 2%", t: { ...DEFAULT_THRESHOLDS, bbWidthMin: 0.02 } },
  { label: "BB width > 4%", t: { ...DEFAULT_THRESHOLDS, bbWidthMin: 0.04 } },
  { label: "Stoch < 85", t: { ...DEFAULT_THRESHOLDS, stochExtreme: 85 } },
  { label: "Stoch < 75", t: { ...DEFAULT_THRESHOLDS, stochExtreme: 75 } },
  { label: "Stoch < 65", t: { ...DEFAULT_THRESHOLDS, stochExtreme: 65 } },
  { label: "VWAP side", t: { ...DEFAULT_THRESHOLDS, requireVwapSide: true } },
  { label: "LC agrees", t: { ...DEFAULT_THRESHOLDS, requireLc: true } },
  { label: "in value area", t: { ...DEFAULT_THRESHOLDS, requireValueArea: true } },
  { label: "swept first", t: { ...DEFAULT_THRESHOLDS, requireSweep: true } },
];

const variants = ONLY ? VARIANTS.filter((v) => v.label === "baseline" || ONLY.includes(v.label)) : VARIANTS;
if (ONLY && variants.length === 1) {
  console.error(`no variant matched --only; labels are:\n  ${VARIANTS.map((v) => v.label).join("\n  ")}`);
  process.exit(1);
}

const cache = JSON.parse(await readFile(`.cache/bars/${UNIVERSE}-1d.json`, "utf8")) as {
  fetchedAt: string;
  bars: Record<string, Candle[]>;
};
const symbols = Object.keys(cache.bars).filter((_, i) => i % STRIDE === 0);

console.log(`${UNIVERSE} · ${symbols.length} symbols (every ${STRIDE}) · cached ${cache.fetchedAt.slice(0, 10)}`);
console.log(`split=${SPLIT}  cut=${new Date(CUT * 1000).toISOString().slice(0, 10)}  costs=${JSON.stringify(DEFAULT_COST_MODEL)}\n`);

/** Bars to feed the engine, plus the timestamp before which trades don't count. */
function slice(bars: Candle[]): { bars: Candle[]; countFrom: number } | null {
  const cutIdx = bars.findIndex((b) => b.t >= CUT);
  if (SPLIT === "is") {
    const isBars = cutIdx < 0 ? bars : bars.slice(0, cutIdx);
    return isBars.length > 400 ? { bars: isBars, countFrom: 0 } : null;
  }
  if (cutIdx < 0) return null;
  // Give the OOS slice real history to warm up on, then discard any trade that
  // opened inside that lead-in — otherwise the "held-out" result quietly
  // includes trades from the training period.
  const from = Math.max(0, cutIdx - LEAD_IN);
  const oos = bars.slice(from);
  return oos.length > 400 ? { bars: oos, countFrom: CUT } : null;
}

const collected = new Map<string, SimTrade[]>(variants.map((v) => [v.label, []]));
let used = 0;
const started = Date.now();

for (const [n, symbol] of symbols.entries()) {
  const s = slice(cache.bars[symbol] ?? []);
  if (!s) continue;
  used++;
  // Built once per symbol and shared by every variant: the Lorentzian series
  // alone costs more than all thirteen backtests put together.
  const snaps = barSnapshots(s.bars);
  for (const v of variants) {
    const r = backtestCandles(symbol, s.bars, 1, v.t, undefined, false, 2.5, DEFAULT_COST_MODEL, 1.5, undefined, snaps);
    const kept = r.trades.filter((t) => t.openedAt.getTime() / 1000 >= s.countFrom);
    collected.get(v.label)!.push(...kept);
  }
  if ((n + 1) % 25 === 0) console.log(`  ...${n + 1}/${symbols.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}

interface Row { label: string; trades: number; winRate: number; avgR: number; totalR: number; pf: number }

function score(label: string, trades: SimTrade[]): Row {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = trades.filter((t) => t.outcome === "win").length;
  const gross = trades.reduce((a, t) => a + Math.max(0, t.pnl), 0);
  const loss = trades.reduce((a, t) => a + Math.max(0, -t.pnl), 0);
  return {
    label,
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    totalR: rs.reduce((a, b) => a + b, 0),
    pf: loss > 0 ? gross / loss : Infinity,
  };
}

const rows = variants.map((v) => score(v.label, collected.get(v.label)!));
const base = rows[0];

console.log(`\n${used} symbols with enough ${SPLIT.toUpperCase()} history\n`);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "inf").padStart(7);
console.log(`${pad("filter", 16)} ${pad("trades", 8)} ${pad("kept", 7)} ${pad("win%", 7)} ${pad("avgR", 7)} ${pad("ΔavgR", 8)} ${pad("totalR", 9)} ${pad("PF", 7)}`);
for (const r of rows) {
  const kept = base.trades ? ((r.trades / base.trades) * 100).toFixed(0) + "%" : "-";
  const dR = r.label === "baseline" ? "" : `${r.avgR - base.avgR >= 0 ? "+" : ""}${(r.avgR - base.avgR).toFixed(3)}`;
  console.log(
    `${pad(r.label, 16)} ${pad(String(r.trades), 8)} ${pad(kept, 7)} ${num(r.winRate, 1)} ${num(r.avgR, 3)} ${pad(dR, 8)} ${num(r.totalR, 1)} ${num(r.pf)}`,
  );
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
