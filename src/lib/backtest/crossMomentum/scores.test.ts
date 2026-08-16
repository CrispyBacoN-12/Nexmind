import { test } from "node:test";
import assert from "node:assert/strict";
import { momentumScores } from "./scores";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const LOOKBACK = 252;
const SKIP = 21;

function bars(closes: number[]): Candle[] {
  // o !== c throughout, so anything reading the wrong field is visible.
  return closes.map((c, i) => ({ t: (18_262 + i) * DAY, o: c * 0.99, h: c * 1.02, l: c * 0.97, c, v: 1_000 }));
}

/** A gently rising series with enough variation for a non-zero sigma. */
function rising(n: number): Candle[] {
  return bars(Array.from({ length: n }, (_, i) => 100 * (1 + i * 0.001) + (i % 7) * 0.3));
}

test("the window needs exactly lookback + skip bars behind the ranking bar", () => {
  const c = rising(400);
  assert.equal(momentumScores(c, 272, LOOKBACK, SKIP), null);
  assert.notEqual(momentumScores(c, 273, LOOKBACK, SKIP), null);
});

test("the raw score is close[i - skip] / close[i - skip - lookback] - 1", () => {
  const c = rising(400);
  const i = 300;
  const expected = c[i - SKIP].c / c[i - SKIP - LOOKBACK].c - 1;
  assert.equal(momentumScores(c, i, LOOKBACK, SKIP)!.raw, expected);
});

test("the most recent `skip` bars are excluded from the score", () => {
  const c = rising(400);
  const base = momentumScores(c, 300, LOOKBACK, SKIP)!;
  const perturbed = c.map((x) => ({ ...x }));
  // Bar 290 sits inside the skipped window (i - skip = 279), so a score that
  // reads it is not 12-1 momentum at all.
  perturbed[290] = { ...perturbed[290], c: 5_000, o: 5_000, h: 5_000, l: 5_000 };
  assert.equal(momentumScores(perturbed, 300, LOOKBACK, SKIP)!.raw, base.raw);
});

test("the score at bar i cannot see bar i + 1", () => {
  // Rewriting bar i+1 IN PLACE is the only shape of test that detects an
  // interior lookahead. Appending bars past the end proves nothing — a loop
  // indexed by i structurally cannot read past its own last index, and that
  // version of this test killed 0 of 32 injected lookahead mutations.
  const c = rising(400);
  const base = momentumScores(c, 300, LOOKBACK, SKIP)!;
  const perturbed = c.map((x) => ({ ...x }));
  perturbed[301] = { ...perturbed[301], c: 9_999, o: 9_999, h: 9_999, l: 9_999, v: 1e9 };

  const after = momentumScores(perturbed, 300, LOOKBACK, SKIP)!;
  assert.equal(after.raw, base.raw);
  assert.equal(after.volAdj, base.volAdj);

  // Vacuity guard: bar 301 is the window's own `end` for i = 322 (window
  // 49..301, since end = 322 - 21 = 301 and start = 301 - 252 = 49), so the
  // perturbation MUST move both scores. Without this the assertions above
  // would also pass against a function that returns a constant.
  const movedBefore = momentumScores(c, 322, LOOKBACK, SKIP)!;
  const movedAfter = momentumScores(perturbed, 322, LOOKBACK, SKIP)!;
  assert.notEqual(movedAfter.raw, movedBefore.raw);
  assert.notEqual(movedAfter.volAdj, movedBefore.volAdj);
});

test("the volatility-adjusted score divides the raw score by the window's return sigma", () => {
  const c = rising(400);
  const i = 300;
  const end = i - SKIP;
  const start = end - LOOKBACK;
  const rets: number[] = [];
  for (let k = start + 1; k <= end; k++) rets.push(c[k].c / c[k - 1].c - 1);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigma = Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1));

  const s = momentumScores(c, i, LOOKBACK, SKIP)!;
  assert.equal(rets.length, LOOKBACK); // the window carries exactly `lookback` returns
  assert.ok(Math.abs(s.volAdj - s.raw / sigma) < 1e-12);
});

test("a flat series is ineligible rather than infinite", () => {
  const flat = bars(Array.from({ length: 400 }, () => 100));
  assert.equal(momentumScores(flat, 300, LOOKBACK, SKIP), null);
});

test("a non-positive close in the window makes the bar ineligible", () => {
  const c = rising(400);
  const perturbed = c.map((x) => ({ ...x }));
  perturbed[100] = { ...perturbed[100], c: 0 };
  assert.equal(momentumScores(perturbed, 300, LOOKBACK, SKIP), null);
  // Vacuity guard: the same bar outside the window leaves the score intact.
  const outside = c.map((x) => ({ ...x }));
  outside[20] = { ...outside[20], c: 0 };
  assert.notEqual(momentumScores(outside, 300, LOOKBACK, SKIP), null);
});
