import { test } from "node:test";
import assert from "node:assert/strict";
import { applyIronRules, riskReward, type ProposedTrade, type AccountState } from "./ironRules";

const baseAcc: AccountState = {
  maxLotPerTrade: 0.5,
  maxSpread: 0.5,
  minRiskReward: 1.5,
};

const goodLong: ProposedTrade = { symbol: "XAUUSD", side: "long", entry: 2350, sl: 2340, tp1: 2370, lot: 0.1, spread: 0.2 };

test("riskReward computes side-aware ratio", () => {
  assert.equal(riskReward(goodLong), 2); // reward 20 / risk 10
  const short: ProposedTrade = { ...goodLong, side: "short", entry: 2350, sl: 2360, tp1: 2330 };
  assert.equal(riskReward(short), 2);
});

test("riskReward returns 0 for inverted levels", () => {
  assert.equal(riskReward({ ...goodLong, tp1: 2345 }), 0); // reward negative
  assert.equal(riskReward({ ...goodLong, sl: 2355 }), 0); // risk negative for a long
});

test("a clean trade passes", () => {
  const v = applyIronRules(goodLong, baseAcc);
  assert.equal(v.passed, true);
  assert.deepEqual(v.failures, []);
});

test("low R:R is rejected", () => {
  const v = applyIronRules({ ...goodLong, tp1: 2355 }, baseAcc); // R:R 0.5
  assert.equal(v.passed, false);
  assert.match(v.failures[0], /R:R/);
});

test("oversized lot is rejected", () => {
  const v = applyIronRules({ ...goodLong, lot: 1.0 }, baseAcc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /lot/.test(f)));
});

test("wide spread is rejected", () => {
  const v = applyIronRules({ ...goodLong, spread: 1.0 }, baseAcc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /spread/.test(f)));
});

test("kill switch blocks all new trades", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, killSwitch: true });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /kill switch/.test(f)));
});

test("max open positions blocks when at the cap", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 5, maxOpenPositions: 5 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /max open positions/.test(f)));
});

test("below the position cap still passes", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 4, maxOpenPositions: 5 });
  assert.equal(v.passed, true);
});

test("applyIronRules: global trading halt blocks every new trade", () => {
  const t = { symbol: "AAPL", side: "long" as const, entry: 100, sl: 98, tp1: 106, lot: 0.1 };
  const acc = {
    maxLotPerTrade: 0.2, minRiskReward: 1.5, globalTradingHalt: true,
  };
  const v = applyIronRules(t, acc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /global trading halt/i.test(f)));
});

// --- leverage guards --------------------------------------------------------
// A CFD account can lose more than the stop says, so each of these refuses when
// it cannot evaluate itself. The "unknown" cases below are the point of the
// rules, not edge cases around them.

const leveredAcc: AccountState = {
  ...baseAcc,
  equity: 10_000,
  openRiskUsd: 200,
  maxTotalRiskPct: 5,
  dayStartEquity: 10_000,
  dailyPnlUsd: -100,
  dailyLossLimitPct: 3,
  marginLevel: 800,
  marginUsed: 500,
  minMarginLevel: 200,
};
const leveredTrade: ProposedTrade = { ...goodLong, riskUsd: 100 };

test("a trade inside every leverage guard passes", () => {
  const v = applyIronRules(leveredTrade, leveredAcc);
  assert.deepEqual(v.failures, []);
});

test("total open risk is capped across positions, not per trade", () => {
  // 480 already at risk + 100 more = 5.8% of 10k, over the 5% cap, while the
  // trade's own lot is well inside maxLotPerTrade.
  const v = applyIronRules(leveredTrade, { ...leveredAcc, openRiskUsd: 480 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /total open risk 5\.80% exceeds max 5%/.test(f)));
});

test("the total risk cap counts the proposed trade, not just what is open", () => {
  // 400 open is 4% — under the cap on its own; the trade is what breaches it.
  const under = applyIronRules({ ...leveredTrade, riskUsd: 50 }, { ...leveredAcc, openRiskUsd: 400 });
  assert.equal(under.passed, true);
  const over = applyIronRules({ ...leveredTrade, riskUsd: 150 }, { ...leveredAcc, openRiskUsd: 400 });
  assert.equal(over.passed, false);
});

test("the total risk cap fails closed when its inputs are missing", () => {
  const noEquity = applyIronRules(leveredTrade, { ...leveredAcc, equity: undefined });
  assert.equal(noEquity.passed, false);
  assert.ok(noEquity.failures.some((f) => /equity is unknown/.test(f)));

  const noRisk = applyIronRules({ ...leveredTrade, riskUsd: undefined }, leveredAcc);
  assert.equal(noRisk.passed, false);
  assert.ok(noRisk.failures.some((f) => /open risk is unknown/.test(f)));
});

test("an unconfigured leverage guard is not enforced", () => {
  // Absent limits mean the desk has not opted in — only a configured limit that
  // cannot be evaluated refuses.
  const v = applyIronRules(goodLong, baseAcc);
  assert.equal(v.passed, true);
});

test("the daily loss limit halts at the limit, not past it", () => {
  const at = applyIronRules(leveredTrade, { ...leveredAcc, dailyPnlUsd: -300 }); // exactly 3%
  assert.equal(at.passed, false);
  assert.ok(at.failures.some((f) => /daily loss 3\.00% reached the limit/.test(f)));

  const under = applyIronRules(leveredTrade, { ...leveredAcc, dailyPnlUsd: -299 });
  assert.equal(under.passed, true);
});

test("a profitable day never trips the daily loss limit", () => {
  const v = applyIronRules(leveredTrade, { ...leveredAcc, dailyPnlUsd: 5_000 });
  assert.equal(v.passed, true);
});

test("the daily loss limit fails closed when today's P/L is unknown", () => {
  const v = applyIronRules(leveredTrade, { ...leveredAcc, dailyPnlUsd: undefined });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /today's P\/L is unknown/.test(f)));
});

test("margin level floor blocks below the floor", () => {
  const v = applyIronRules(leveredTrade, { ...leveredAcc, marginLevel: 150 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /margin level 150\.0% below floor 200%/.test(f)));
});

test("margin level 0 on a flat account is not a breach", () => {
  // MT5 reports margin_level 0 when no margin is in use. Reading that as a
  // breach would refuse every trade on an empty account.
  const v = applyIronRules(leveredTrade, { ...leveredAcc, marginLevel: 0, marginUsed: 0 });
  assert.equal(v.passed, true);
});

test("margin level 0 with margin in use is a breach", () => {
  const v = applyIronRules(leveredTrade, { ...leveredAcc, marginLevel: 0, marginUsed: 500 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /margin level/.test(f)));
});

test("the margin floor fails closed when margin is unknown", () => {
  const v = applyIronRules(leveredTrade, { ...leveredAcc, marginLevel: undefined });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /margin is unknown/.test(f)));
});
