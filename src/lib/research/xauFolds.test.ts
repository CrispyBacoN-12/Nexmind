import "dotenv/config"; // xauFolds.ts -> mechanisms.ts -> engine.ts -> scanner.ts constructs prisma at module scope — same reason panelRun.test.ts does this
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XAU_FOLDS,
  XAU_FOLD_ORDER,
  XAU_WARMUP_BARS,
  XAU_VALIDATION_TAG,
  XAU_EVIDENCE_CAVEAT,
  XAU_COSTS,
  XAU_GATE_COST_LEVEL,
  XAU_POINT_SIZE,
  XAU_COMMISSION_POINTS,
  XAU_SESSION_FILTER,
  MIN_XAU_BLOCKS,
  xauFolds,
  xauFoldList,
  xauTestFolds,
  xauFoldViolations,
  xauCostPoints,
  xauCostSpec,
  xauSessionFilter,
  xauCellKey,
  xauVerdict,
  type XauFold,
  type XauFoldName,
  type XauFoldRow,
} from "./xauFolds";
import { XAU_MAX_LOOKBACK_BARS, XAU_HYPOTHESES, MECHANISMS } from "./mechanisms";
import { FOLDS, PANEL_WARMUP_BARS } from "./panel";

// A table that satisfies the pre-registered rule, used to prove the validator
// accepts a correct one. The dates are FIXTURES, not a proposal: the real table
// is [PENDING] on the broker's actual H1 depth, and inventing it here would be
// exactly the move the null is preventing.
const valid: Record<XauFoldName, XauFold> = {
  xfit: { name: "xfit", from: "2004-01-01", to: "2008-01-01", regime: "early bull", direction: "up" },
  xselect: { name: "xselect", from: "2012-01-01", to: "2016-01-01", regime: "bear", direction: "down" },
  xtest1: { name: "xtest1", from: "2016-01-01", to: "2019-01-01", regime: "range", direction: "up" },
  xtest2: { name: "xtest2", from: "2019-01-01", to: "2022-01-01", regime: "covid spike", direction: "up" },
  xtest3: { name: "xtest3", from: "2022-01-01", to: "2027-01-01", regime: "rate shock then bull", direction: "up" },
};

test("the fold table is [PENDING], and every accessor fails closed while it is", () => {
  // If this test starts failing, the table has been filled in — which is
  // allowed, but only alongside the checks below and a commit that lands the
  // table BEFORE any strategy number exists.
  assert.equal(XAU_FOLDS, null);
  for (const fn of [xauFolds, xauFoldList, xauTestFolds]) {
    assert.throws(fn, /PENDING/, `${fn.name} must refuse rather than invent dates`);
  }
});

test("the refusal names what unblocks it, not just that it is blocked", () => {
  // A gate that says only "not configured" gets worked around; one that names
  // the probe and the document gets satisfied.
  assert.throws(xauFolds, /probe-xau-data/);
  assert.throws(xauFolds, /preregistration/);
});

test("a correctly cut table has no violations", () => {
  assert.deepEqual(xauFoldViolations(valid), []);
});

test("overlapping folds are caught", () => {
  const v = xauFoldViolations({
    ...valid,
    xtest2: { ...valid.xtest2, from: "2018-06-01" }, // reaches back into xtest1
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /xtest2.*overlaps xtest1/);
});

test("a TEST fold that starts before the fitting folds end is not held out", () => {
  // The one error that would make every gold number meaningless while still
  // producing a table that reads plausibly.
  const v = xauFoldViolations({
    ...valid,
    xselect: { ...valid.xselect, from: "2020-01-01", to: "2023-01-01" },
  });
  assert.ok(v.some((s) => /xtest1 starts before the fitting folds end/.test(s)));
});

test("FIT and SELECT in the same direction is refused", () => {
  const v = xauFoldViolations({ ...valid, xselect: { ...valid.xselect, direction: "up" } });
  assert.equal(v.length, 1);
  assert.match(v[0], /both up.*opposite-direction/);
});

test("a fold that ends before it starts, or carries no regime, is reported", () => {
  const v = xauFoldViolations({
    ...valid,
    xtest3: { ...valid.xtest3, from: "2027-01-01", to: "2022-01-01", regime: "  " },
  });
  assert.equal(v.length, 2);
  assert.ok(v.some((s) => /ends at or before it starts/.test(s)));
  assert.ok(v.some((s) => /no regime description/.test(s)));
});

test("a mis-keyed fold is caught before the date walk reads it", () => {
  const v = xauFoldViolations({ ...valid, xtest1: { ...valid.xtest1, name: "xtest2" } });
  assert.equal(v.length, 1);
  assert.match(v[0], /keyed xtest1 but names itself xtest2/);
});

test("the fold order covers the name space exactly", () => {
  // Mirrors panel.test.ts's check on FOLDS: either every name is reachable
  // through the exports, or a fold exists that nothing ever runs.
  assert.deepEqual(new Set(XAU_FOLD_ORDER), new Set(Object.keys(valid)));
  assert.equal(XAU_FOLD_ORDER.length, 5);
});

test("the gold name space is disjoint from the equity one", () => {
  // Not cosmetic: the whole point of the separate namespace is that an xau-v1
  // verdict can never be read, or persisted, as a panel-v1 one.
  const equity = new Set(Object.keys(FOLDS));
  assert.ok(XAU_FOLD_ORDER.every((n) => !equity.has(n)));
  assert.notEqual(XAU_VALIDATION_TAG, "panel-v1");
});

test("the warm-up clears the longest lookback any gold rule uses", () => {
  // The check that would have caught a 250-bar warm-up silently running
  // xau-daily-trend's 480-bar mean cold for the first fold of every run.
  assert.ok(
    XAU_WARMUP_BARS > XAU_MAX_LOOKBACK_BARS,
    `warm-up ${XAU_WARMUP_BARS} does not clear the ${XAU_MAX_LOOKBACK_BARS}-bar lookback`,
  );
  assert.ok(XAU_WARMUP_BARS - XAU_MAX_LOOKBACK_BARS >= PANEL_WARMUP_BARS);
});

test("there are exactly four hypotheses and mr-down3 is the same object the equity screen ran", () => {
  // Four, not nine. Each extra row is another draw, and on one symbol the free
  // lift from re-drawing is larger than on the panel, not smaller.
  assert.equal(XAU_HYPOTHESES.length, 4);
  assert.equal(XAU_HYPOTHESES[0], MECHANISMS.find((m) => m.key === "mr-down3"));
  assert.deepEqual(XAU_HYPOTHESES.map((m) => m.key), [
    "mr-down3",
    "xau-session-break",
    "xau-asia-fade",
    "xau-daily-trend",
  ]);
});

test("MIN_XAU_BLOCKS is two years of months", () => {
  assert.equal(MIN_XAU_BLOCKS, 24);
});

// --- the bar ---------------------------------------------------------------

// A row that passes everything, so each test below can break exactly one thing.
// The numbers are fixtures and describe no market.
const okRow = (fold: XauFoldName): XauFoldRow => ({
  fold,
  costLevel: "p90",
  trades: 400,
  blocks: 30,
  avgR: 0.08,
  controlMedian: 0.02,
  controlP95: 0.05,
  bootstrapP5: 0.03,
  longTrades: 200,
  longAvgR: 0.09,
  shortTrades: 200,
  shortAvgR: 0.07,
});

const passing = (): XauFoldRow[] => XAU_FOLD_ORDER.map(okRow);

test("a candidate clearing every condition passes", () => {
  const v = xauVerdict(passing());
  assert.deepEqual(v.failures, []);
  assert.equal(v.passed, true);
});

test("a missing fold is refused rather than judged on four", () => {
  const v = xauVerdict(passing().slice(0, 4));
  assert.equal(v.passed, false);
  assert.match(v.failures[0], /expected 5 folds, got 4/);
});

test("the bar is only ever read at the p90 cost level", () => {
  // The failure this prevents: a row that passed at median costs being carried
  // into the verdict beside four p90 rows.
  const rows = passing();
  rows[2] = { ...rows[2], costLevel: "median" };
  const v = xauVerdict(rows);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /evaluated at p90 costs.*xtest1=median/.test(f)));
});

test("beating the control median in 4 of 5 is a failure, and the failing fold is named", () => {
  const rows = passing();
  rows[1] = { ...rows[1], avgR: 0.01 }; // below its own control median
  const v = xauVerdict(rows);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /median in 4\/5.*xselect/.test(f)));
});

test("an unmeasurable fold fails the median condition instead of abstaining from it", () => {
  const rows = passing();
  rows[0] = { ...rows[0], avgR: null };
  assert.equal(xauVerdict(rows).passed, false);
});

test("a null bootstrap reads as unverified, never as a pass", () => {
  const rows = passing().map((r) => ({ ...r, bootstrapP5: null }));
  const v = xauVerdict(rows);
  assert.equal(v.passed, false);
  assert.ok(v.notes.some((n) => /unverified/.test(n)));
  assert.ok(v.failures.some((f) => /bootstrap p5.*0\/5/.test(f)));
});

test("thin folds are named individually, by trades and by months", () => {
  const rows = passing();
  rows[3] = { ...rows[3], trades: 199, blocks: 23 };
  const v = xauVerdict(rows);
  assert.ok(v.failures.some((f) => /xtest2: 199 trades/.test(f)));
  assert.ok(v.failures.some((f) => /xtest2: trades occupy 23 distinct months/.test(f)));
});

test("a lift that exists only on the long side is refused as exposure", () => {
  // The trap that caught single 2/2.5/3: positive on longs in 4/5 folds and
  // negative on shorts in 15 of 15 cells, and it was drift.
  const rows = passing().map((r) => ({ ...r, shortAvgR: -0.02 }));
  const v = xauVerdict(rows);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /EXPOSURE, NOT EDGE/.test(f)));
});

test("an unmeasured side is a failure, not a silent pass", () => {
  const rows = passing();
  rows[4] = { ...rows[4], shortAvgR: null };
  const v = xauVerdict(rows);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /split missing for xtest3/.test(f)));
});

test("the caveat every gold verdict carries says what it is weaker than", () => {
  assert.match(XAU_EVIDENCE_CAVEAT, /weaker evidence than panel-v1/);
  assert.match(XAU_EVIDENCE_CAVEAT, /time-series bootstrap/);
});

test("the cost model is [PENDING] and refuses to fall back to DEFAULT_COST_MODEL", () => {
  assert.equal(XAU_COSTS, null);
  assert.throws(xauCostPoints, /PENDING/);
  assert.throws(xauCostPoints, /Do not substitute DEFAULT_COST_MODEL/);
  assert.equal(XAU_GATE_COST_LEVEL, "p90");
});

test("the contract spec refuses one missing part as loudly as three", () => {
  // A factor-of-100 point size would not make any downstream number LOOK
  // wrong, which is why it is a throw and not a default.
  assert.equal(XAU_POINT_SIZE, null);
  assert.equal(XAU_COMMISSION_POINTS, null);
  assert.throws(xauCostSpec, /PENDING/);
});

test("the session filter distinguishes 'no excluded cells' from 'never measured'", () => {
  // An empty list is a legitimate outcome of the ratio rule; null means the
  // profile was never built, and running unfiltered would silently drop a
  // pre-registered rule.
  assert.equal(XAU_SESSION_FILTER, null);
  assert.throws(xauSessionFilter, /PENDING/);
  assert.throws(xauSessionFilter, /empty list is a valid answer/);
});

test("a cell key is the UTC day and hour, so the profile and the bars agree", () => {
  const sunday22 = Date.UTC(2026, 8, 6, 22) / 1000; // Sunday, the weekly open
  assert.equal(xauCellKey(sunday22), "0:22");
  const friday21 = Date.UTC(2026, 8, 11, 21) / 1000;
  assert.equal(xauCellKey(friday21), "5:21");
});
