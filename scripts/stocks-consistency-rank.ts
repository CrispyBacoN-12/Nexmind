// Ranks the screener's shortlist (liquidity + volatility + no-bank passed) by
// how often the already-live "ADX-Ignition Breakout" strategy (US Stocks Desk
// #11, dispatch-stocks-run.ts) actually fires and wins on each individual
// name, on 1d/2y. Answers "which of these stocks realistically produce
// frequent, consistent small wins" rather than "just clears the liquidity/
// volatility bar" - no strategy wins every single day, so this is the honest
// operationalization of that ask: high win rate (>=55.6%, the breakeven
// threshold for this desk's 1.5/1.2 ATR ladder) AND high trade frequency.
// Usage: npx tsx scripts/stocks-consistency-rank.ts
import { screenUniverse } from "../src/lib/trading/screener";
import { UNIVERSES } from "../src/lib/trading/universe";
import { fetchCandlesBatch } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const RISK_USD = 100;
const TP1_MULT = 1.2; // production ladder: SL=1.5xATR, TP=1.2xATR
const MIN_TRADES = 6;
const MIN_WIN_RATE = 55.6;

const ADX_IGNITION_CODE = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`;

interface Row { symbol: string; trades: number; winRate: number; tradesPerYear: number; annPnl: number; }

async function main() {
  console.log("Screening sp500 universe (liquidity/ATR/no-bank)...");
  const screened = await screenUniverse(UNIVERSES["sp500"].symbols);
  const shortlist = screened.filter((r) => r.passed).map((r) => r.symbol);
  console.log(`Shortlist: ${shortlist.length} symbols. Fetching 2y daily bars...`);

  const data = await fetchCandlesBatch(shortlist, "2y", "1d");
  const compiled = compileStrategy(ADX_IGNITION_CODE);
  const rows: Row[] = [];

  for (const symbol of shortlist) {
    const resp = data.get(symbol);
    if (!resp || resp.candles.length < 100) continue;
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    const yearFactor = 365 / days;
    const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    const result = backtestCandles(symbol, bars, 0.1, undefined, entry, true, TP1_MULT);
    const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const wins = result.trades.filter((t) => t.outcome === "win").length;
    const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
    const annPnl = rs.reduce((s, r) => s + r * RISK_USD, 0) * yearFactor;
    const tradesPerYear = result.trades.length * yearFactor;
    rows.push({ symbol, trades: result.trades.length, winRate, tradesPerYear, annPnl });
  }

  const qualified = rows.filter((r) => r.trades >= MIN_TRADES && r.winRate >= MIN_WIN_RATE);
  qualified.sort((a, b) => b.tradesPerYear - a.tradesPerYear);

  console.log(`\n${rows.length} symbols backtested, ${qualified.length} clear >=${MIN_WIN_RATE}% win rate with >=${MIN_TRADES} trades over 2y\n`);
  console.log(`Ranked by trade frequency (most consistent opportunity first):`);
  for (const r of qualified) {
    console.log(`  ${r.symbol.padEnd(6)} trades=${String(r.trades).padStart(3)} (${r.tradesPerYear.toFixed(1)}/yr) win%=${r.winRate.toFixed(1).padStart(5)} ann=$${r.annPnl.toFixed(0)}`);
  }
}

main().then(() => process.exit(0));
