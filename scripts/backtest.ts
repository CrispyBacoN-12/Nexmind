// Backtest the rule-based core (Scanner → ATR levels → TP ladder) on Yahoo history.
// No AI, no quota — this is the honest baseline to compare live AI-filtered results against.
//
// Usage:
//   npm run backtest                          → nasdaq100 preset, 1y of 1h bars
//   npm run backtest -- dow30                 → another preset (us-mega, dow30, nasdaq100, set-mega, set50)
//   npm run backtest -- AAPL,MSFT,GC=F        → explicit symbols
//   npm run backtest -- nasdaq100 --range=2y  → longer window (Yahoo caps 1h history at ~730d)

import { fetchYahooCandlesSmart, type Range } from "../src/lib/yahoo";
import { UNIVERSES, prepareSymbols } from "../src/lib/trading/universe";
import { getWatchlist } from "../src/lib/trading/watchlist";
import { backtestCandles, type SimTrade } from "../src/lib/backtest/engine";
import { computeStats } from "../src/lib/trading/stats";
import { prisma } from "../src/lib/db";

const CONCURRENCY = 4;

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Map(
    process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"] as const;
    }),
  );
  const range = (flags.get("range") ?? "1y") as Range;

  // Resolve the symbol list: preset name, comma list, or default nasdaq100 + watchlist.
  let symbols: string[];
  let label: string;
  const first = args[0];
  if (first && UNIVERSES[first]) {
    symbols = UNIVERSES[first].symbols;
    label = UNIVERSES[first].label;
  } else if (first) {
    symbols = first.split(",");
    label = "custom list";
  } else {
    const wl = await getWatchlist();
    symbols = [...UNIVERSES["nasdaq100"].symbols, ...wl.filter((w) => w.enabled).map((w) => w.symbol)];
    label = "nasdaq100 + watchlist";
  }
  symbols = prepareSymbols(symbols, 200);

  console.log(`Backtesting ${symbols.length} symbols (${label}) · ${range} of 1h bars · rule-based core only (no AI)\n`);

  const all: SimTrade[] = [];
  const failures: string[] = [];
  let signals = 0;
  let openAtEnd = 0;
  let done = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      try {
        const resp = await fetchYahooCandlesSmart(symbol, range, "1h");
        const r = backtestCandles(resp.symbol, resp.candles);
        all.push(...r.trades);
        signals += r.signals;
        if (r.openAtEnd) openAtEnd++;
      } catch {
        failures.push(symbol);
      }
      done++;
      if (done % 20 === 0) console.log(`  …${done}/${symbols.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (all.length === 0) {
    console.log("No closed trades produced. (failures:", failures.join(",") || "none", ")");
    return;
  }

  // ---- report ----
  const closed = all
    .map((t) => ({ pnl: t.pnl, rMultiple: t.rMultiple, outcome: t.outcome as string | null, closedAt: t.closedAt }))
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const s = computeStats(closed);

  const wins = all.filter((t) => t.pnl > 0).length;
  const be = all.filter((t) => t.outcome === "breakeven").length;
  const tp1Partials = all.filter((t) => t.tp1Hit).length;
  const fmt = (n: number, d = 2) => n.toFixed(d);

  console.log("\n══════════ OVERALL ══════════");
  console.log(`signals ${signals} · closed trades ${all.length} (+${openAtEnd} still open at end) · failed fetch ${failures.length}`);
  console.log(`win rate        ${fmt(s.winRate, 1)}%  (${wins} profitable, ${be} breakeven)`);
  console.log(`net P/L         $${fmt(s.pnl)}   (lot 0.1, point value 1)`);
  console.log(`expectancy      $${fmt(s.expectancy, 3)} per trade`);
  console.log(`avg R multiple  ${fmt(s.avgR ?? 0, 2)}`);
  console.log(`max drawdown    $${fmt(s.maxDrawdown)}`);
  console.log(`TP1 partial hit ${tp1Partials}/${all.length} trades`);

  // monthly breakdown
  const byMonth = new Map<string, { n: number; pnl: number; wins: number }>();
  for (const t of all) {
    const k = t.closedAt.toISOString().slice(0, 7);
    const m = byMonth.get(k) ?? { n: 0, pnl: 0, wins: 0 };
    m.n++; m.pnl += t.pnl; if (t.pnl > 0) m.wins++;
    byMonth.set(k, m);
  }
  console.log("\n══════════ BY MONTH ══════════");
  for (const [k, m] of [...byMonth.entries()].sort()) {
    console.log(`${k}  trades ${String(m.n).padStart(3)} · win ${fmt((m.wins / m.n) * 100, 0).padStart(3)}% · P/L $${fmt(m.pnl)}`);
  }

  // best/worst symbols
  const bySym = new Map<string, { n: number; pnl: number }>();
  for (const t of all) {
    const m = bySym.get(t.symbol) ?? { n: 0, pnl: 0 };
    m.n++; m.pnl += t.pnl;
    bySym.set(t.symbol, m);
  }
  const ranked = [...bySym.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  console.log("\n══════════ TOP 5 / BOTTOM 5 SYMBOLS ══════════");
  for (const [sym, m] of ranked.slice(0, 5)) console.log(`  ${sym.padEnd(8)} ${String(m.n).padStart(3)} trades · $${fmt(m.pnl)}`);
  console.log("  …");
  for (const [sym, m] of ranked.slice(-5)) console.log(`  ${sym.padEnd(8)} ${String(m.n).padStart(3)} trades · $${fmt(m.pnl)}`);

  console.log("\nNote: pessimistic fills (same-bar SL-and-TP counts as loss). Live AI filtering (HAWK consensus + SAGE veto)");
  console.log("sits ON TOP of these signals — compare this baseline with the Reports page to measure what the AI adds.");
}

main().finally(() => prisma.$disconnect());
