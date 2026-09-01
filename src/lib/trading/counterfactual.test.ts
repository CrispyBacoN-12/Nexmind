import "dotenv/config"; // counterfactual.ts -> db.ts constructs prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareArms, dedupeBars, recordAction, replay } from "./counterfactual";
import { DEFAULT_COST_MODEL, type SimPosition } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

type Row = { aiOutcome: string; aiR: number | null; mockR: number | null };
const row = (aiOutcome: string, aiR: number | null, mockR: number | null): Row => ({ aiOutcome, aiR, mockR });

test("compareArms: a veto is scored as 0, not excluded", () => {
  // The whole point of the table. If refusals were dropped, this desk would
  // report avgR +1.00 off a single lucky trade while its two vetoes dodged
  // nothing — which is exactly the survivorship read we are replacing.
  const c = compareArms([
    row("executed", 1.0, 1.0),
    row("vetoed", 0, 2.0),
    row("vetoed", 0, 2.0),
  ]);
  assert.equal(c.ai.opportunities, 3);
  assert.equal(c.ai.traded, 1);
  assert.ok(Math.abs(c.ai.avgR - 1 / 3) < 1e-9);
  assert.ok(Math.abs(c.mock.avgR - 5 / 3) < 1e-9);
  // Both vetoes threw away a +2R — the analysts cost the desk money here.
  assert.ok(c.edgePerOpportunity < 0);
  assert.equal(c.refused, 2);
  assert.equal(c.refusedAvgR, 2);
});

test("compareArms: vetoes that dodged losers show up as a positive edge", () => {
  const c = compareArms([
    row("executed", 2.0, 2.0),
    row("no-consensus", 0, -1.0),
    row("rules-blocked", 0, -1.0),
  ]);
  assert.equal(c.refusedAvgR, -1);
  assert.ok(Math.abs(c.edgePerOpportunity - 2 / 3) < 1e-9);
});

test("compareArms: win rate is per trade taken, avgR is per opportunity", () => {
  const c = compareArms([row("executed", 1, 1), row("vetoed", 0, -1)]);
  // One trade, one winner: 100% — a 0R stand-aside is not a losing trade.
  assert.equal(c.ai.winRate, 100);
  assert.equal(c.ai.avgR, 0.5); // ...but it does halve the average.
  assert.equal(c.mock.traded, 2);
  assert.equal(c.mock.winRate, 50);
});

test("compareArms: unresolved rows are dropped, and an empty set does not divide by zero", () => {
  const c = compareArms([row("executed", 1, 1), row("executed", null, 3), row("vetoed", 0, null)]);
  assert.equal(c.ai.opportunities, 1);
  assert.equal(c.mock.totalR, 1); // the +3 was never resolved and must not count

  const empty = compareArms([]);
  assert.equal(empty.ai.avgR, 0);
  assert.equal(empty.mock.winRate, 0);
  assert.equal(empty.refusedAvgR, 0);
  assert.equal(empty.edgePerOpportunity, 0);
});

test("compareArms: byOutcome reports what each kind of refusal would have earned", () => {
  const c = compareArms([
    row("vetoed", 0, -1),
    row("vetoed", 0, 1),
    row("no-consensus", 0, -2),
    row("executed", 1.5, 1.5),
  ]);
  assert.equal(c.byOutcome.vetoed.count, 2);
  assert.equal(c.byOutcome.vetoed.mockAvgR, 0); // SAGE's vetoes were a coin flip
  assert.equal(c.byOutcome["no-consensus"].mockAvgR, -2);
  assert.equal(c.byOutcome.executed.count, 1);
});

// ---- replay ----

const HOUR = 3600;
const T0 = 1_750_000_000;

/** A position long from 100 with a 2-point stop and a single 4-point target. */
function longPos(over: Partial<SimPosition> = {}): SimPosition {
  return {
    side: "long", entry: 100, sl: 98, tp1: 104, tp2: null, trail: null,
    lot: 1, openedAt: new Date(T0 * 1000), costs: DEFAULT_COST_MODEL, ladder: {},
    ...over,
  };
}

const bar = (i: number, l: number, h: number): Candle => ({ t: T0 + (i + 1) * HOUR, o: 100, h, l, c: (h + l) / 2, v: 1000 });

test("replay: a target hit settles as a win with a positive R", () => {
  const r = replay(longPos(), [bar(0, 99.5, 101), bar(1, 100, 105)]);
  assert.equal(r.settled, true);
  assert.ok(r.r! > 1.5, `expected ~+2R, got ${r.r}`);
  assert.match(r.note, /^win at 10/);
});

test("replay: a bar touching both stop and target books the loss", () => {
  // stepPosition is deliberately pessimistic — the counterfactual must inherit
  // that, or the mock arm gets a free optimism the live backtest never grants.
  const r = replay(longPos(), [bar(0, 97, 106)]);
  assert.equal(r.settled, true);
  assert.match(r.note, /^loss/);
  assert.ok(r.r! < 0);
});

test("replay: a position that never resolves reports unsettled, not zero", () => {
  // A row like this must stay unresolved rather than be scored as a scratch —
  // writing 0R here would quietly bias both arms toward the middle.
  const r = replay(longPos(), [bar(0, 99.5, 101), bar(1, 99, 102)]);
  assert.equal(r.settled, false);
  assert.equal(r.r, null);
  assert.match(r.note, /still open after 2 bars/);
});

test("replay: no forward bars means no verdict", () => {
  assert.equal(replay(longPos(), []).settled, false);
});

// ---- one bar, one row ----

test("recordAction: the first sighting of a bar is written", () => {
  assert.deepEqual(recordAction(null, "no-consensus"), { kind: "create" });
  assert.deepEqual(recordAction(null, "executed"), { kind: "create" });
});

test("recordAction: re-scanning an unchanged bar does not write a second row", () => {
  // The bug this replaces: on a weekly timeframe the scanner re-fires the same
  // unchanged bar every day, and a refusal creates no Trade — so the Trade-level
  // dedupe in the engine never caught it. Portfolio #11 recorded EIX four times
  // and FTV four times off one bar each, every copy stopping out at the same
  // price on the same day, which inflated the arm comparison ~2.4x.
  assert.deepEqual(recordAction({ id: 7, aiOutcome: "no-consensus" }, "no-consensus"), { kind: "skip", id: 7 });
  assert.deepEqual(recordAction({ id: 7, aiOutcome: "vetoed" }, "no-consensus"), { kind: "skip", id: 7 });
});

test("recordAction: a later execution on the same bar replaces the stand-aside", () => {
  // Skipping unconditionally would bias the ledger toward refusals: Monday's
  // no-consensus would be kept and Wednesday's actual entry on the same bar
  // dropped, so the one row that has a real trade behind it would go missing.
  assert.deepEqual(recordAction({ id: 7, aiOutcome: "no-consensus" }, "executed"), { kind: "update", id: 7 });
});

// ---- collapsing the rows written before the guard existed ----

const cfRow = (symbol: string, mockEntry: number, aiOutcome = "no-consensus", extra: Partial<{ mockSl: number; id: number }> = {}) => ({
  id: extra.id ?? 0, symbol, timeframe: "1wk", scanSide: "long",
  mockEntry, mockSl: extra.mockSl ?? mockEntry - 5, aiOutcome,
});

test("dedupeBars: one bar scanned four times counts once", () => {
  // EIX, portfolio #11: four rows off one weekly bar, identical entry and stop,
  // every copy stopping out at the same price on the same day.
  const rows = [cfRow("EIX", 86.12), cfRow("EIX", 86.12), cfRow("EIX", 86.12), cfRow("EIX", 86.12)];
  assert.equal(dedupeBars(rows).length, 1);
});

test("dedupeBars: a different bar on the same symbol is a different opportunity", () => {
  // Same symbol, next week, new entry and stop — that is a second real setup and
  // collapsing it would hide a decision rather than a duplicate.
  assert.equal(dedupeBars([cfRow("EIX", 86.12), cfRow("EIX", 91.40)]).length, 2);
  assert.equal(dedupeBars([cfRow("EIX", 86.12), cfRow("EIX", 86.12, "no-consensus", { mockSl: 80.1 })]).length, 2);
});

test("dedupeBars: the executed copy is the one kept", () => {
  // Same rule as recordAction: the row with a real trade behind it wins.
  const kept = dedupeBars([cfRow("FTV", 78.04, "no-consensus", { id: 1 }), cfRow("FTV", 78.04, "executed", { id: 2 })]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 2);
});

test("dedupeBars: otherwise the first sighting is kept, matching the write path", () => {
  const kept = dedupeBars([cfRow("FTV", 78.04, "no-consensus", { id: 1 }), cfRow("FTV", 78.04, "vetoed", { id: 2 })]);
  assert.deepEqual(kept.map((r) => r.id), [1]);
});
