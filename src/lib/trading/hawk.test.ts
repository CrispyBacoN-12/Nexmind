import "dotenv/config"; // hawk.ts -> context.ts -> scanner.ts -> research/adapter.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { personasFor } from "./hawk";
import { personaLens } from "./context";

// Why HAWK fields a different trio per strategy family
// -----------------------------------------------------
// Live evidence, 2026-08-23..08-30 on portfolio #11 (combo-vote, a trend
// combo): `trend` voted long 39 / short 3 / skip 3, while `structure` and
// `counter` voted skip on 45 of 45. Nothing cleared 2-of-3 and the desk took no
// trade for seven days.
//
// A live HAWK call on FAST showed why `counter` never agrees. Its lens says
// "call it a fade only on real exhaustion", so it rules on whether to FADE the
// bar — not on whether the scanner's long is any good. It answered: "RSI 59 and
// %B 0.81 are elevated but not extreme ... this is a strong trend pullback
// setup, not exhaustion, so a mean-reversion fade isn't justified" → skip. That
// reasoning is evidence FOR the long. A mean-reversion voter on a continuation
// setup is structurally incapable of confirming it, so the 2-of-3 bar was really
// a 2-of-2 unanimity bar between the two remaining analysts.

test("a trend-family setup fields no mean-reversion voter", () => {
  assert.ok(!personasFor("trend").includes("counter"));
});

test("a trend-family setup gets the exhaustion analyst as its skeptic", () => {
  // The replacement asks the answerable question — is the move already spent? —
  // so the same reading that made `counter` abstain can now confirm.
  assert.ok(personasFor("trend").includes("exhaustion"));
});

test("a reversion-family setup keeps the mean-reversion voter", () => {
  // There the fade IS the setup, so `counter` can genuinely confirm or refuse.
  assert.ok(personasFor("reversion").includes("counter"));
  assert.ok(!personasFor("reversion").includes("exhaustion"));
});

test("an unclassified strategy keeps the original trio unchanged", () => {
  assert.deepEqual(personasFor("mixed"), ["trend", "structure", "counter"]);
});

test("every family fields exactly three analysts, so the 2-of-3 bar keeps its meaning", () => {
  // Dropping a voter without replacing it turns 2-of-3 into 2-of-2 unanimity —
  // which is precisely the failure being fixed.
  for (const f of ["trend", "reversion", "mixed"] as const) {
    assert.equal(personasFor(f).length, 3, `${f} must field 3`);
    assert.equal(new Set(personasFor(f)).size, 3, `${f} must field 3 distinct`);
  }
});

test("every persona a family fields has a lens written for it", () => {
  for (const f of ["trend", "reversion", "mixed"] as const) {
    for (const p of personasFor(f)) assert.ok(personaLens(p)?.length > 0, `${f}/${p} has no lens`);
  }
});

test("the exhaustion lens treats an unextended reading as a reason to confirm", () => {
  // The whole defect was a lens that could only ever abstain. This one has to
  // say out loud that "not extended" means take the trade.
  const lens = personaLens("exhaustion");
  assert.match(lens, /confirm/i);
  assert.match(lens, /room|not extended|unextended/i);
});
