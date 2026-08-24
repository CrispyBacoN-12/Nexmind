// One-factor-at-a-time sweep of the EXIT ladder, holding the entry rule fixed
// at the trend-pullback baseline with DEFAULT_THRESHOLDS.
//
// Why this exists: every study in docs/quant/ so far has tested the entry side.
// The exit multiples have never been swept at all — ATR_SL_MULT=1.5,
// ATR_TP_MULT=2.5, TP2_FACTOR=1.6 and "no trailing stop" are hardcoded
// constants in src/lib/backtest/engine.ts that nobody has ever measured. Mean R
// is (entry edge) x (exit geometry), and only the first factor has been under
// the microscope.
//
// Unlike the confluence filters, these variants are NOT vetoes. They do not
// delete entries — they change where each trade ends, which changes when the
// symbol frees up for the next entry, so trade COUNTS move in both directions.
// "n vs base" is reported for that reason, not as a keep-rate.
//
// R-multiples stay comparable across different stop widths because rMultiple is
// normalised by each trade's own initial risk (entry - origSl). A 3.0-ATR stop
// risking three times as much per trade is not flattered by this table; it is
// measured per unit of risk taken, which is the only way the rows mean the same
// thing. Absolute dollars are NOT comparable across rows.
//
// Protocol, same as scripts/setup-filter-sweep.mts: run --split=is, pick from
// that table ALONE, then confirm the picks with --split=oos --only=...  With 21
// variants on one sample, an in-sample t near 2 is roughly what the best of 21
// coin flips produces anyway — the out-of-sample column is the whole test, not
// a formality.
//
// Usage:
//   node --env-file=.env --import tsx scripts/exit-geometry-sweep.mts --split=is --interval=1wk
//   node --env-file=.env --import tsx scripts/exit-geometry-sweep.mts --split=oos --interval=1wk --only="SL 2.0 ATR,trail 1.5/1.5"
//
// Flags: --split=is|oos  --interval=1d|1wk  --universe=sp500|dow30
//        --every=N (symbol stride)  --only=label,label

import { readFile } from "node:fs/promises";
import { backtestCandles, barSnapshots, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { DEFAULT_THRESHOLDS } from "@/lib/trading/scanner";
import type { Candle } from "@/lib/indicators";
import type { SimTrade } from "@/lib/backtest/engine";

const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;

// "all" ignores the IS/OOS cut and runs the whole series. It exists only for
// --byYear: a regime breakdown that stopped at 2023 would answer nothing, since
// the question is precisely whether the post-2023 bull market is carrying the
// result. Do NOT use --split=all to judge a variant — it has no held-out half.
const SPLIT = (arg("split", "is") as "is" | "oos" | "all");
// Bucket trades by the calendar year they opened in, instead of pooling them.
// A pooled avgR cannot distinguish "works everywhere" from "works in 2023-2025
// and is dead the rest of the time", and for a trailing stop in a trending
// market that is the whole question.
const BY_YEAR = process.argv.includes("--byYear");
const INTERVAL = (arg("interval", "1wk") as "1d" | "1wk");
const UNIVERSE = arg("universe", "sp500")!;
const STRIDE = Number(arg("every", "3"));
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
if (INTERVAL !== "1d" && INTERVAL !== "1wk") { console.error("--interval must be 1d or 1wk"); process.exit(1); }

// Monday-anchored UTC weeks, matching how Yahoo stamps its own 1wk bars. Epoch 0
// is a Thursday, hence the 4-day shift. (Same resampling as setup-filter-sweep,
// so the two sweeps' tables can be read side by side.)
const WEEK = 604_800;
const MONDAY_EPOCH = 345_600;
function toWeekly(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  let bucket = NaN;
  for (const d of daily) {
    const wk = Math.floor((d.t - MONDAY_EPOCH) / WEEK);
    if (wk !== bucket) {
      out.push({ ...d });
      bucket = wk;
      continue;
    }
    const w = out[out.length - 1];
    w.h = Math.max(w.h, d.h);
    w.l = Math.min(w.l, d.l);
    w.c = d.c;
    w.v += d.v;
  }
  return out;
}

// Same held-out period as every other study in docs/quant — fixed by calendar
// before any result was seen. Reusing it keeps the OOS sample honest ONLY as
// long as nothing is tuned on it; see the protocol note in the header.
const CUT = Date.UTC(2023, 0, 1) / 1000;
const LEAD_IN = INTERVAL === "1wk" ? 120 : 300;
const MIN_BARS = INTERVAL === "1wk" ? 160 : 400;

type Exit = {
  label: string;
  slMult: number;
  tp1Mult: number;
  singleTarget: boolean;
  trail?: { activateMult: number; offsetMult: number };
};

const BASE = { slMult: 1.5, tp1Mult: 2.5, singleTarget: false } as const;

// Four interpretable axes, each moving ONE thing away from the desk default.
// Nothing here is a grid search over pairs: with a few thousand trades per row
// the sample cannot support 100 cells, and a two-factor winner would be
// unreadable anyway.
const VARIANTS: Exit[] = [
  { label: "baseline", ...BASE },

  // A) stop distance, target held at 2.5 ATR with the tp2 ladder
  { label: "SL 1.0 ATR", ...BASE, slMult: 1.0 },
  { label: "SL 2.0 ATR", ...BASE, slMult: 2.0 },
  { label: "SL 2.5 ATR", ...BASE, slMult: 2.5 },
  { label: "SL 3.0 ATR", ...BASE, slMult: 3.0 },

  // B) target distance, stop held at 1.5 ATR with the tp2 ladder
  { label: "TP 1.5 ATR", ...BASE, tp1Mult: 1.5 },
  { label: "TP 2.0 ATR", ...BASE, tp1Mult: 2.0 },
  { label: "TP 3.5 ATR", ...BASE, tp1Mult: 3.5 },
  { label: "TP 5.0 ATR", ...BASE, tp1Mult: 5.0 },

  // C) single target instead of a partial leg toward tp2. This is the geometry
  // every research-N strategy trades live (engine.ts RESEARCH_ATR_*), so
  // "single 1.2 ATR" is here as the literal live ladder: 1.2/1.5 = 0.8:1
  // reward:risk, which needs a >55% win rate merely to break even.
  { label: "single 1.2 ATR", ...BASE, tp1Mult: 1.2, singleTarget: true },
  { label: "single 1.5 ATR", ...BASE, tp1Mult: 1.5, singleTarget: true },
  { label: "single 2.0 ATR", ...BASE, tp1Mult: 2.0, singleTarget: true },
  { label: "single 2.5 ATR", ...BASE, tp1Mult: 2.5, singleTarget: true },
  { label: "single 3.0 ATR", ...BASE, tp1Mult: 3.0, singleTarget: true },

  // D) trailing stop. NOTE this is not "ladder plus a trail" — positionRules
  // .decideAction short-circuits to decideTrailingAction whenever trail is set,
  // so tp1/tp2 are ignored entirely and these rows are pure "ride until the
  // trail is hit, or the hard 1.5-ATR SL if it never arms". Varying tp1Mult
  // alongside a trail would produce identical rows, which is why no such
  // variant appears here. activate = how far in favour price must go before the
  // trail arms; offset = how far behind the best price it then sits.
  { label: "trail 1.0/1.5", ...BASE, trail: { activateMult: 1.0, offsetMult: 1.5 } },
  { label: "trail 1.5/1.5", ...BASE, trail: { activateMult: 1.5, offsetMult: 1.5 } },
  { label: "trail 1.5/2.0", ...BASE, trail: { activateMult: 1.5, offsetMult: 2.0 } },
  { label: "trail 2.0/2.0", ...BASE, trail: { activateMult: 2.0, offsetMult: 2.0 } },
  { label: "trail 2.0/3.0", ...BASE, trail: { activateMult: 2.0, offsetMult: 3.0 } },
  { label: "trail 3.0/3.0", ...BASE, trail: { activateMult: 3.0, offsetMult: 3.0 } },
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
const barsFor = (symbol: string): Candle[] => {
  const daily = cache.bars[symbol] ?? [];
  return INTERVAL === "1wk" ? toWeekly(daily) : daily;
};

console.log(`${UNIVERSE} · ${symbols.length} symbols (every ${STRIDE}) · cached ${cache.fetchedAt.slice(0, 10)}`);
console.log(`split=${SPLIT}  interval=${INTERVAL}${INTERVAL === "1wk" ? " (resampled from daily)" : ""}  cut=${new Date(CUT * 1000).toISOString().slice(0, 10)}  costs=${JSON.stringify(DEFAULT_COST_MODEL)}`);
console.log(`entry: trend-pullback @ DEFAULT_THRESHOLDS (fixed) · ${variants.length} exit variants\n`);

/** Bars to feed the engine, plus the timestamp before which trades don't count. */
function slice(bars: Candle[]): { bars: Candle[]; countFrom: number } | null {
  const cutIdx = bars.findIndex((b) => b.t >= CUT);
  if (SPLIT === "all") return bars.length > MIN_BARS ? { bars, countFrom: 0 } : null;
  if (SPLIT === "is") {
    const isBars = cutIdx < 0 ? bars : bars.slice(0, cutIdx);
    return isBars.length > MIN_BARS ? { bars: isBars, countFrom: 0 } : null;
  }
  if (cutIdx < 0) return null;
  // Give the OOS slice real history to warm up on, then discard any trade that
  // opened inside that lead-in — otherwise the "held-out" result quietly
  // includes trades from the training period.
  const from = Math.max(0, cutIdx - LEAD_IN);
  const oos = bars.slice(from);
  return oos.length > MIN_BARS ? { bars: oos, countFrom: CUT } : null;
}

const collected = new Map<string, SimTrade[]>(variants.map((v) => [v.label, []]));
let used = 0;
const started = Date.now();

for (const [n, symbol] of symbols.entries()) {
  const s = slice(barsFor(symbol));
  if (!s) continue;
  used++;
  // Built once per symbol and shared by every variant. The entry rule is
  // identical across rows here, so these snapshots are the only indicator work
  // the whole sweep needs.
  const snaps = barSnapshots(s.bars);
  for (const v of variants) {
    const r = backtestCandles(
      symbol, s.bars, 1, DEFAULT_THRESHOLDS, undefined,
      v.singleTarget, v.tp1Mult, DEFAULT_COST_MODEL, v.slMult, v.trail, snaps,
    );
    const kept = r.trades.filter((t) => t.openedAt.getTime() / 1000 >= s.countFrom);
    collected.get(v.label)!.push(...kept);
  }
  if ((n + 1) % 25 === 0) console.log(`  ...${n + 1}/${symbols.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}

interface Row { label: string; trades: number; winRate: number; avgR: number; sdR: number; tStat: number; totalR: number; pf: number }

function score(label: string, trades: SimTrade[]): Row {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = trades.filter((t) => t.outcome === "win").length;
  const gross = trades.reduce((a, t) => a + Math.max(0, t.pnl), 0);
  const loss = trades.reduce((a, t) => a + Math.max(0, -t.pnl), 0);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  // avgR is unreadable without its dispersion: R-multiples scatter with sd near
  // 1, so even on a few thousand trades the standard error is ~0.03 — the same
  // size as most deltas this sweep produces. |t| < 2 means "indistinguishable
  // from no edge", however good the number looks.
  const varR = rs.length > 1 ? rs.reduce((a, b) => a + (b - avgR) ** 2, 0) / (rs.length - 1) : 0;
  const sdR = Math.sqrt(varR);
  return {
    label,
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgR,
    sdR,
    tStat: sdR > 0 && rs.length ? avgR / (sdR / Math.sqrt(rs.length)) : 0,
    totalR: rs.reduce((a, b) => a + b, 0),
    pf: loss > 0 ? gross / loss : Infinity,
  };
}

const rows = variants.map((v) => score(v.label, collected.get(v.label)!));
const base = rows[0];

console.log(`\n${used} symbols with enough ${SPLIT.toUpperCase()} history at ${INTERVAL}\n`);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "inf").padStart(7);

if (BY_YEAR) {
  const years = [...new Set(
    variants.flatMap((v) => collected.get(v.label)!.map((t) => t.openedAt.getUTCFullYear())),
  )].sort();
  console.log(`${pad("year", 6)} ${pad("exit", 18)} ${pad("trades", 8)} ${pad("win%", 7)} ${pad("avgR", 7)} ${pad("dAvgR", 8)} ${pad("t", 7)} ${pad("totalR", 9)}`);
  for (const y of years) {
    const yearRows = variants.map((v) =>
      score(v.label, collected.get(v.label)!.filter((t) => t.openedAt.getUTCFullYear() === y)),
    );
    const yBase = yearRows[0];
    for (const r of yearRows) {
      const dR = r.label === yBase.label ? "" : `${r.avgR - yBase.avgR >= 0 ? "+" : ""}${(r.avgR - yBase.avgR).toFixed(3)}`;
      console.log(
        `${pad(String(y), 6)} ${pad(r.label, 18)} ${pad(String(r.trades), 8)} ${num(r.winRate, 1)} ${num(r.avgR, 3)} ${pad(dR, 8)} ${num(r.tStat, 2)} ${num(r.totalR, 1)}`,
      );
    }
    console.log("");
  }
  console.log(`pooled over all years:\n`);
}
console.log(`${pad("exit", 18)} ${pad("trades", 8)} ${pad("n vs base", 10)} ${pad("win%", 7)} ${pad("avgR", 7)} ${pad("dAvgR", 8)} ${pad("sdR", 7)} ${pad("t", 7)} ${pad("totalR", 9)} ${pad("PF", 7)}`);
for (const r of rows) {
  const rel = base.trades ? ((r.trades / base.trades) * 100).toFixed(0) + "%" : "-";
  const dR = r.label === "baseline" ? "" : `${r.avgR - base.avgR >= 0 ? "+" : ""}${(r.avgR - base.avgR).toFixed(3)}`;
  console.log(
    `${pad(r.label, 18)} ${pad(String(r.trades), 8)} ${pad(rel, 10)} ${num(r.winRate, 1)} ${num(r.avgR, 3)} ${pad(dR, 8)} ${num(r.sdR, 2)} ${num(r.tStat, 2)} ${num(r.totalR, 1)} ${num(r.pf)}`,
  );
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
