// panel.ts is pure and file-system-only — no prisma, no network, so these run
// without DATABASE_URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import {
  foldSlice, FOLDS, FIT_FOLD, SELECT_FOLD, TEST_FOLDS, PANEL_WARMUP_BARS,
  PANEL_VALIDATION, LEGACY_VALIDATION, type Fold,
} from "./panel";

const DAY = 86_400;
const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

/** Daily bars from `startIso`, one per day, close = 100 + index. */
function dailyBars(startIso: string, n: number): Candle[] {
  const t0 = epoch(startIso);
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    return { t: t0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
}

const fold = (from: string, to: string): Fold => ({ name: "fit", from, to, regime: "fixture" });

test("the fold layout is disjoint, ordered, and puts every TEST fold after both fitting folds", () => {
  // The one property the whole design rests on. If a TEST fold ever overlaps
  // FIT or SELECT, every number downstream — retention, control margin,
  // bootstrap — is measuring the training set again, which is the exact fault
  // (66% self-overlap) this file replaced.
  const all = [FIT_FOLD, SELECT_FOLD, ...TEST_FOLDS];
  for (let i = 1; i < all.length; i++) {
    assert.ok(
      epoch(all[i].from) >= epoch(all[i - 1].to),
      `${all[i].name} starts before ${all[i - 1].name} ends`,
    );
  }
  for (const t of TEST_FOLDS) {
    assert.ok(epoch(t.from) >= epoch(FIT_FOLD.to), `${t.name} overlaps the FIT fold`);
    assert.ok(epoch(t.from) >= epoch(SELECT_FOLD.to), `${t.name} overlaps the SELECT fold`);
  }
  assert.equal(TEST_FOLDS.length, 3);
  // Every fold in FOLDS must be reachable through one of the three exports, or
  // a fold exists that nothing ever runs.
  assert.deepEqual(new Set(Object.keys(FOLDS)), new Set(all.map((f) => f.name)));
});

test("foldSlice returns exactly the bars inside [from, to) as tradable", () => {
  const bars = dailyBars("2020-01-01", 400);
  const slice = foldSlice(bars, fold("2020-06-01", "2020-09-01"), 0);
  assert.equal(slice.entryFrom, 0);
  assert.ok(slice.candles.every((b) => b.t >= epoch("2020-06-01") && b.t < epoch("2020-09-01")));
  assert.equal(slice.tradableBars, slice.candles.length);
  // `to` is exclusive: the bar dated exactly on the boundary belongs to the
  // NEXT fold. Getting this wrong leaks one bar of the held-out set into the
  // fitting set on every fold boundary.
  assert.ok(slice.candles.every((b) => b.t !== epoch("2020-09-01")));
});

test("foldSlice prepends warm-up bars that inform indicators but are never tradable", () => {
  const bars = dailyBars("2020-01-01", 400);
  const slice = foldSlice(bars, fold("2020-07-01", "2020-10-01"), 30);
  assert.equal(slice.entryFrom, 30, "30 prior bars must sit in front of the fold");
  assert.equal(slice.candles.length, slice.entryFrom + slice.tradableBars);
  // The warm-up prefix must be the bars immediately BEFORE the fold, not the
  // first 30 bars of it — otherwise the fold's own opening month is consumed as
  // warm-up and the sample silently shrinks.
  assert.ok(slice.candles[slice.entryFrom].t >= epoch("2020-07-01"));
  assert.ok(slice.candles[slice.entryFrom - 1].t < epoch("2020-07-01"));
});

test("foldSlice takes whatever warm-up exists when the symbol's history is shorter than the window", () => {
  // A name that lists 10 days before the fold gets 10 bars of warm-up, not an
  // error and not a silently shifted entryFrom.
  const bars = dailyBars("2020-06-21", 200);
  const slice = foldSlice(bars, fold("2020-07-01", "2020-10-01"), PANEL_WARMUP_BARS);
  assert.equal(slice.entryFrom, 10);
  assert.ok(slice.tradableBars > 0);
});

test("foldSlice reports tradableBars 0 for a symbol with no bars in the fold", () => {
  // A 2021 listing did not participate in a 2020 fold. Zero-filling it would
  // deflate the participation floor for a reason that has nothing to do with
  // the strategy, so callers drop these instead.
  const listedLate = dailyBars("2021-03-01", 200);
  assert.equal(foldSlice(listedLate, fold("2020-01-01", "2021-01-01")).tradableBars, 0);

  const delistedEarly = dailyBars("2016-01-01", 100);
  assert.equal(foldSlice(delistedEarly, fold("2020-01-01", "2021-01-01")).tradableBars, 0);

  assert.equal(foldSlice([], fold("2020-01-01", "2021-01-01")).tradableBars, 0);
});

test("foldSlice runs to the end of history when the fold extends past the last bar", () => {
  // FOLDS.test3 ends 2027-01-01 against a cache that stops in 2026 — the
  // open-ended case is the live one, not an edge case.
  const bars = dailyBars("2024-01-01", 300);
  const slice = foldSlice(bars, fold("2024-06-01", "2027-01-01"), 0);
  assert.equal(slice.candles[slice.candles.length - 1].t, bars[bars.length - 1].t);
});

test("the two validation tags are distinct and legacy is the one the DB defaults to", () => {
  // prisma/schema.prisma hardcodes the default string; if these ever drift, the
  // desk gate in adapter.getResearchStrategy silently matches nothing (or, far
  // worse, everything).
  assert.notEqual(PANEL_VALIDATION, LEGACY_VALIDATION);
  assert.equal(PANEL_VALIDATION, "panel-v1");
  assert.equal(LEGACY_VALIDATION, "legacy-single-symbol");
});
