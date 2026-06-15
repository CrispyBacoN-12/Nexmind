import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolioStats, type PortfolioTrade } from "./portfolioStats";

function t(status: string, pnl: number | null, day: string | null): PortfolioTrade {
  return { status, pnl, rMultiple: null, outcome: null, closedAt: day ? new Date(day) : null };
}

test("computePortfolioStats: empty portfolio sits at starting balance", () => {
  const s = computePortfolioStats([], 10000);
  assert.equal(s.equity, 10000);
  assert.equal(s.realizedPnl, 0);
  assert.equal(s.openCount, 0);
  assert.equal(s.currentDrawdownPct, 0);
});

test("computePortfolioStats: realized P/L and equity from closed trades; open trades counted", () => {
  const trades = [t("closed", 100, "2026-06-01"), t("closed", -40, "2026-06-02"), t("open", null, null)];
  const s = computePortfolioStats(trades, 10000);
  assert.equal(s.realizedPnl, 60);
  assert.equal(s.equity, 10060);
  assert.equal(s.openCount, 1);
});

test("computePortfolioStats: drawdown reflects peak-to-current on closed trades", () => {
  const trades = [t("closed", 200, "2026-06-01"), t("closed", -100, "2026-06-02")];
  const s = computePortfolioStats(trades, 10000);
  assert.ok(Math.abs(s.currentDrawdownPct - (100 / 10200) * 100) < 1e-9);
});
