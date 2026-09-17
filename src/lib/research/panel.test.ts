// panel.ts is pure and file-system-only — no prisma, no network, so these run
// without DATABASE_URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  foldSlice, FOLDS, FIT_FOLD, SELECT_FOLD, TEST_FOLDS, PANEL_WARMUP_BARS,
  PANEL_VALIDATION, LEGACY_VALIDATION, isPlaceholderBar, sanitizeSeries,
  loadPanel, resetPanelCache, type Fold,
  DEEP_FOLDS, DEEP_FOLD_LIST, DEEP_CACHE_START, DEEP_PANEL_CACHE_PATH, PANEL_CACHE_PATH,
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

// ---- placeholder bars ----

const frozen = (t: number, price: number): Candle => ({ t, o: price, h: price, l: price, c: price, v: 0 });

test("isPlaceholderBar matches only the unambiguous shape: no range AND no volume", () => {
  // The two half-matches are real market events, not filler. A zero-range bar
  // with volume is a limit-up/halt print; a zero-volume bar with range is a
  // stale quote that still moved. Roughly 400 bars in the live cache are one of
  // those, and guessing about them would repeat the mistake being fixed here.
  assert.equal(isPlaceholderBar(frozen(0, 3.15)), true);
  assert.equal(isPlaceholderBar({ t: 0, o: 10, h: 10, l: 10, c: 10, v: 5000 }), false, "halted but traded");
  assert.equal(isPlaceholderBar({ t: 0, o: 10, h: 11, l: 9, c: 10, v: 0 }), false, "no volume but a range");
  assert.equal(isPlaceholderBar({ t: 0, o: 10, h: 11, l: 9, c: 10.5, v: 1000 }), false);
});

test("sanitizeSeries removes placeholders and leaves a gap rather than bridging it", () => {
  // The gap is the honest record: the symbol was not trading. Interpolating a
  // price nobody traded at would put invented history inside a TEST fold.
  const t0 = epoch("2023-06-01");
  const rows: Candle[] = [
    { t: t0, o: 100, h: 101, l: 99, c: 100, v: 1000 },
    frozen(t0 + DAY, 100),
    frozen(t0 + 2 * DAY, 100),
    { t: t0 + 3 * DAY, o: 115, h: 116, l: 113, c: 115, v: 3000 },
  ];
  const { candles, dropped } = sanitizeSeries(rows);
  assert.equal(dropped, 2);
  assert.deepEqual(candles.map((b) => b.t), [t0, t0 + 3 * DAY]);
  assert.deepEqual(sanitizeSeries([]), { candles: [], dropped: 0 });
});

test("loadPanel applies the sanitizer itself and reports what each symbol lost", () => {
  // Filtering at the call sites instead would mean a verdict depends on which
  // script ran. loadPanel is the only door into the panel, so it is the door
  // that has to hold.
  const t0 = epoch("2023-06-01");
  const good = dailyBars("2023-06-01", 5);
  const dir = mkdtempSync(join(tmpdir(), "nexmind-panel-"));
  const path = join(dir, "fixture.json");
  writeFileSync(path, JSON.stringify({
    fetchedAt: "2026-08-16T20:39:45.212Z",
    bars: {
      CLEAN: good,
      DIRTY: [good[0], frozen(t0 + DAY, 100), good[2], frozen(t0 + 3 * DAY, 100)],
      ALLFAKE: [frozen(t0, 5), frozen(t0 + DAY, 5)],
    },
  }));

  resetPanelCache();
  const panel = loadPanel(path);
  try {
    assert.deepEqual(panel.symbols, ["CLEAN", "DIRTY"], "a series that was entirely placeholder is not history");
    assert.equal(panel.bars.CLEAN.length, 5);
    assert.deepEqual(panel.bars.DIRTY.map((b) => b.t), [t0, t0 + 2 * DAY]);
    assert.deepEqual(panel.droppedBars, { DIRTY: 2 }, "only symbols that lost bars are listed");
    assert.ok(panel.bars.DIRTY.every((b) => !isPlaceholderBar(b)));
  } finally {
    resetPanelCache();
  }
});

// ---- deep folds ----

test("the deep folds are disjoint, ordered, and every one of them ends before FIT begins", () => {
  // The whole value of these three windows is that no decision in this project
  // has ever seen them. An overlap with FIT would quietly make the hold-out a
  // re-read of the training set, which is the same fault the panel replaced —
  // just harder to notice, because the numbers would still look new.
  for (let i = 1; i < DEEP_FOLD_LIST.length; i++) {
    assert.ok(
      epoch(DEEP_FOLD_LIST[i].from) >= epoch(DEEP_FOLD_LIST[i - 1].to),
      `${DEEP_FOLD_LIST[i].name} starts before ${DEEP_FOLD_LIST[i - 1].name} ends`,
    );
  }
  for (const d of DEEP_FOLD_LIST) {
    assert.ok(epoch(d.to) <= epoch(FIT_FOLD.from), `${d.name} runs past the start of FIT`);
  }
  assert.deepEqual(new Set(Object.keys(DEEP_FOLDS)), new Set(DEEP_FOLD_LIST.map((f) => f.name)));
});

test("the deep cache starts early enough to warm the first deep fold", () => {
  // PANEL_WARMUP_BARS is 250 TRADING days. A cache that began the month before
  // deep1 would hand it about twenty, leaving deep1's indicators cold while
  // deep2 and deep3 ran warm — a boundary artifact that would surface as deep1
  // disagreeing with the other two, i.e. as a regime finding.
  const tradingDaysPerYear = 252;
  const years = (epoch(DEEP_FOLD_LIST[0].from) - epoch(DEEP_CACHE_START)) / (365.25 * DAY);
  assert.ok(
    years * tradingDaysPerYear >= PANEL_WARMUP_BARS,
    `${DEEP_CACHE_START} gives deep1 only ~${Math.round(years * tradingDaysPerYear)} warm-up bars`,
  );
});

test("the deep cache is a different file from the panel cache", () => {
  // Splicing the two would make "which data produced this number" unanswerable
  // from the number, and the deep folds are only worth running because that
  // question has an answer.
  assert.notEqual(DEEP_PANEL_CACHE_PATH, PANEL_CACHE_PATH);
});

test("loadPanel alternating between two caches in one process returns each one's own bars", () => {
  // loadPanel memoises into a single slot keyed on the path. The deep hold-out
  // is the first caller that reads two caches in one process, and a memo that
  // returned the first cache's bars for the second path would silently run the
  // pre-2016 folds against post-2016 data — producing a full, plausible, wrong
  // verdict with no error anywhere.
  const dir = mkdtempSync(join(tmpdir(), "nexmind-panel-two-"));
  const shallowPath = join(dir, "shallow.json");
  const deepPath = join(dir, "deep.json");
  writeFileSync(shallowPath, JSON.stringify({ fetchedAt: "2026-01-01T00:00:00.000Z", bars: { SHALLOW: dailyBars("2020-01-01", 5) } }));
  writeFileSync(deepPath, JSON.stringify({ fetchedAt: "2026-02-02T00:00:00.000Z", bars: { DEEP: dailyBars("2001-01-01", 7) } }));

  resetPanelCache();
  try {
    for (let round = 0; round < 2; round++) {
      const shallow = loadPanel(shallowPath);
      assert.deepEqual(shallow.symbols, ["SHALLOW"]);
      assert.equal(shallow.bars.SHALLOW.length, 5);
      assert.equal(shallow.fetchedAt, "2026-01-01T00:00:00.000Z");

      const deep = loadPanel(deepPath);
      assert.deepEqual(deep.symbols, ["DEEP"]);
      assert.equal(deep.bars.DEEP.length, 7);
      assert.equal(deep.fetchedAt, "2026-02-02T00:00:00.000Z");
    }
  } finally {
    resetPanelCache();
  }
});
