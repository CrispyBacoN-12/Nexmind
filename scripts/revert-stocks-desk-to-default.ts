// Takes research-29 (RSI-50 Momentum Cross, weekly) off the US Stocks Desk and
// puts the desk back on the built-in trend-pullback rule while a replacement is
// found. Reverses scripts/activate-stocks-weekly-strategy.ts.
//
// Why: research-29 was approved on a backtest of EIGHT trades (87.5% win,
// +0.575 avgR). Live it has produced 32 trades since 2026-06-23 at 43.8% win
// and -0.108 avgR (-3.46R, -$376). n=8 could not have distinguished a real edge
// from a coin, and it didn't.
//
// Why trend-pullback rather than another candidate: it is the only rule on this
// desk with an out-of-sample measurement behind it
// (docs/quant/2026-08-23-confluence-filter-sweep-results.md) — 1135 OOS weekly
// trades at +0.044 avgR, t=1.08. That is NOT an established edge either; it is
// an edge that cannot be distinguished from zero on held-out data. It is chosen
// because "measured, roughly flat" beats "unmeasured, currently losing", not
// because it is expected to make money.
//
// scanInterval/scanRange stay at 1wk/5y. The same study found trend-pullback is
// a coin flip on daily bars (PF 0.95 in-sample, 1.00 out) and positive on both
// halves of the weekly sample — the weekly timeframe is the only one where the
// rule shows anything at all.
import { prisma } from "../src/lib/db";

const PORTFOLIO_ID = 11; // US Stocks Desk

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  const openTrades = await prisma.trade.count({ where: { portfolioId: PORTFOLIO_ID, status: "open" } });
  if (openTrades > 0) {
    console.error(
      `${openTrades} position(s) still open — switch entry rules on a flat book, ` +
      `or the exits get managed by a rule that did not open them.`
    );
    process.exit(1);
  }
  const after = await prisma.portfolio.update({
    where: { id: PORTFOLIO_ID },
    data: { strategy: "trend-pullback" },
  });
  console.log(
    `Updated portfolio ${PORTFOLIO_ID}: strategy ${before?.strategy} -> ${after.strategy}, ` +
    `scan ${after.scanInterval}/${after.scanRange} (unchanged), maxOpenPositions ${after.maxOpenPositions}`
  );
}
main().then(() => process.exit(0));
