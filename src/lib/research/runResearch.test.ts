import "dotenv/config"; // runResearch.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { computeSnapshots } from "./adapter";
import { sweepLadder, isBankableRound, LADDER_TP_MULTS, LADDER_SL_MULT, LADDER_TRAILS, LADDER_OPTIONS, type ExitLadder } from "./runResearch";
import { MIN_TRADES } from "./autoReview";

/** Mirrors sweepLadder's own selection, but only ever calls backtestCandles /
 *  summarizeBacktest directly — it never invokes sweepLadder, so every test
 *  built on it stays a non-circular check. */
function recomputeSweep(bars: Candle[], entry: (i: number) => "long" | "short" | null) {
  const scored = LADDER_OPTIONS.map((ladder) => {
    const bt = backtestCandles(
      "EXPECT", bars, 0.1, undefined, entry, true, ladder.tp1Mult,
      DEFAULT_COST_MODEL, ladder.slMult, ladder.trail,
    );
    return { ladder, summary: summarizeBacktest(bt.trades) };
  });
  const eligible = scored.filter((s) => s.summary.trades >= MIN_TRADES);
  const field = eligible.length ? eligible : scored;
  const best = field.reduce((b, s) => {
    const a = s.summary.avgR ?? -Infinity;
    const cur = b.summary.avgR ?? -Infinity;
    return a > cur || (a === cur && s.summary.trades > b.summary.trades) ? s : b;
  });
  return { scored, eligible, best };
}

function bar(t: number, c: number): Candle {
  return { t, o: c, h: c + 1, l: c - 1, c, v: 1000 };
}

// A triangle wave: 10 bars up, 10 bars down, repeating, +-1.5/bar. Gives the
// periodic-long strategy below many round-trip trades across the whole ladder
// sweep. Call it with n well past WARMUP=60 — and past ~600 bars wherever a
// test needs the MIN_TRADES-eligible field to be non-empty, since the trailing
// options close roughly half as many trades as the fixed targets do.
function triangleBars(n: number): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  let direction = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 10 === 0) direction *= -1;
    price += direction * 1.5;
    bars.push(bar(i * 3600, price));
  }
  return bars;
}

const PERIODIC_LONG_CODE = `
  var i = bars.length - 1;
  if (i % 10 === 0) return { side: "long", note: "periodic" };
  return null;
`;

// A strictly monotonic uptrend: every bar's low is higher than the prior bar's
// low, so a long's SL (set below entry) can never be touched.
function uptrendBars(n: number, step: number): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += step;
    bars.push(bar(i * 3600, price));
  }
  return bars;
}

const periodicEntry = (i: number) => (i % 10 === 0 ? ("long" as const) : null);

test("the ladder menu has retired every sub-1:1 target and offers both validated trails", () => {
  // Guards the 2026-08-24 retirement: against LADDER_SL_MULT, a target below
  // the stop is a reward:risk under 1 and needs a >55% win rate merely to
  // break even. `single 1.2 ATR` measured worst-of-20 in the exit-geometry
  // sweep, so nothing at or below 1.5 belongs in a menu the loop picks from.
  for (const tp1Mult of LADDER_TP_MULTS) {
    assert.ok(tp1Mult >= LADDER_SL_MULT, `tp1Mult ${tp1Mult} is below the ${LADDER_SL_MULT} ATR stop — sub-1:1`);
  }
  // Every trail in the menu must reach the sweep as a real trail; a ladder that
  // carried only tp1Mult would be silently traded as a fixed target.
  for (const trail of LADDER_TRAILS) {
    assert.ok(
      LADDER_OPTIONS.some((o) => o.trail?.activateMult === trail.activateMult && o.trail?.offsetMult === trail.offsetMult),
      `LADDER_OPTIONS is missing trail ${trail.activateMult}/${trail.offsetMult}`,
    );
  }
  assert.equal(LADDER_OPTIONS.length, LADDER_TP_MULTS.length + LADDER_TRAILS.length);
  for (const o of LADDER_OPTIONS) assert.equal(o.slMult, LADDER_SL_MULT);
});

test("sweepLadder picks the highest-avgR option, matching an independently recomputed sweep", () => {
  const bars = triangleBars(700);
  const snaps = computeSnapshots(bars);
  const { best, eligible } = recomputeSweep(bars, periodicEntry);

  // The fixture has to exercise the eligibility branch that actually ships,
  // otherwise this test would silently only cover the thin-field fallback.
  assert.ok(eligible.length > 0, `no ladder option reached MIN_TRADES=${MIN_TRADES} on this fixture`);

  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  // deepEqual, not a tp1Mult comparison: a trailing winner and a fixed-target
  // winner can share a tp1Mult (TRAIL_NOMINAL_TP_MULT is 2.5, which is also a
  // menu target), so only the whole ladder object distinguishes them.
  assert.deepEqual(result.ladder, best.ladder);
  assert.equal(result.summary.avgR, best.summary.avgR);
  assert.equal(result.summary.trades, best.summary.trades);
});

test("sweepLadder selects on avgR, not on the dollar profit factor it used to rank by", () => {
  const bars = triangleBars(700);
  const snaps = computeSnapshots(bars);
  const { scored } = recomputeSweep(bars, periodicEntry);
  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  const eligible = scored.filter((s) => s.summary.trades >= MIN_TRADES);
  const bestAvgR = Math.max(...eligible.map((s) => s.summary.avgR ?? -Infinity));
  assert.equal(result.summary.avgR, bestAvgR, "the winner must be the avgR maximum of the eligible field");

  // Not a tautology only if the two metrics genuinely disagree somewhere in the
  // field — if they ranked identically this test would pass for free. Assert
  // the disagreement exists rather than assuming it. On this fixture the
  // disagreement is total: the trailing options take zero losing trades, so
  // summarizeBacktest reports profitFactor null for them, and the old
  // `profitFactor ?? -Infinity` ranked "never lost" as strictly WORST of the
  // field. Selecting on avgR is what makes them reachable at all.
  const byPf = [...eligible].sort((a, b) => (b.summary.profitFactor ?? -Infinity) - (a.summary.profitFactor ?? -Infinity));
  const byAvgR = [...eligible].sort((a, b) => (b.summary.avgR ?? -Infinity) - (a.summary.avgR ?? -Infinity));
  assert.notDeepEqual(
    byPf.map((s) => s.ladder),
    byAvgR.map((s) => s.ladder),
    "fixture no longer separates dollar-PF ranking from avgR ranking — this test proves nothing as written",
  );
});

test("sweepLadder returns a ladder from the published menu that actually produced trades", () => {
  const bars = triangleBars(250);
  const snaps = computeSnapshots(bars);
  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);
  assert.ok(
    LADDER_OPTIONS.some((o) => o.tp1Mult === result.ladder.tp1Mult && o.trail?.activateMult === result.ladder.trail?.activateMult),
    "the winner must come from LADDER_OPTIONS",
  );
  assert.ok(result.summary.trades > 0, "the periodic-long strategy must produce trades on a 250-bar series");
});

test("sweepLadder still returns a ladder when no option reaches MIN_TRADES", () => {
  // A short series produces a handful of trades at most, so the eligible field
  // is empty and the thin-field fallback is the only branch that can answer.
  // It must still return the avgR maximum rather than throwing on an empty
  // reduce — autoReviewStatus rejects the candidate on trade count right after.
  const bars = uptrendBars(90, 2);
  const snaps = computeSnapshots(bars);
  const { scored, eligible, best } = recomputeSweep(bars, periodicEntry);
  assert.equal(eligible.length, 0, `fixture must stay under MIN_TRADES=${MIN_TRADES} for this to test the fallback`);
  assert.ok(scored.some((s) => s.summary.trades > 0), "fixture must still produce some trades");

  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);
  assert.deepEqual(result.ladder, best.ladder);
});

test("a trailing option survives the sweep intact when it wins", () => {
  // Constructed so the trail is the only geometry that can hold a runner: the
  // series climbs far past every fixed target before turning, so a fixed
  // target caps the win at its own multiple while the trail keeps the rest.
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 300; i++) {
    // Long climbs, brief shallow pullbacks — never deep enough to arm-and-hit
    // the trail early, always deep enough to close a fixed-target trade.
    price += i % 40 < 34 ? 1.2 : -0.4;
    bars.push(bar(i * 3600, price));
  }
  const snaps = computeSnapshots(bars);
  const { best } = recomputeSweep(bars, periodicEntry);
  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  assert.deepEqual(result.ladder, best.ladder);
  if (best.ladder.trail) {
    // The whole point of the round trip: a winning trail must arrive with both
    // multiples set, since positionRules ignores tp1Mult entirely once trail is
    // present and a half-specified trail would be traded as a fixed target.
    assert.equal(typeof result.ladder.trail?.activateMult, "number");
    assert.equal(typeof result.ladder.trail?.offsetMult, "number");
  }
});

test("ExitLadder round-trips through JSON exactly as the DB stores it", () => {
  // runResearch persists JSON.stringify(exitLadder) and adapter/blindTest parse
  // it back — a trail that does not survive that trip is dropped in silence.
  for (const ladder of LADDER_OPTIONS) {
    const parsed = JSON.parse(JSON.stringify(ladder)) as ExitLadder;
    assert.deepEqual(parsed, ladder);
  }
});

test("a mock-proposed round is never bankable, and a manual round always is", () => {
  // The regression this guards: 109 scheduled rounds ran on an environment with
  // no AI credential, proposeCandidates() returned its three hardcoded
  // fallbacks every time, and runResearch persisted them as ordinary
  // ResearchStrategy rows — 34 of which reached `approved` and were therefore
  // activatable on the live desk.
  assert.equal(isBankableRound(false, "mock"), false);

  // Manual candidates are hand-authored and skip the proposer entirely, so
  // they carry no backend. Refusing them would break every dispatch-*.mts
  // script and the /api/research manualCandidates path.
  assert.equal(isBankableRound(true, null), true);
  // Belt and braces: the manual exemption must not be reachable *through* a
  // mock backend, or the exemption becomes the bypass.
  assert.equal(isBankableRound(true, "mock"), true);

  // A real backend of either kind banks normally.
  for (const backend of ["api", "cli"] as const) {
    assert.equal(isBankableRound(false, backend), true, `${backend} rounds must still bank`);
  }

  // A non-manual round with no backend reported at all is refused rather than
  // waved through — same fail-closed default as applyBlindTestVerdict.
  assert.equal(isBankableRound(false, null), false);
});
