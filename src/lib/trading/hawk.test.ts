import "dotenv/config"; // hawk.ts -> context.ts -> scanner.ts -> research/adapter.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { countableVotes, describePanel, personasFor } from "./hawk";
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

// One analyst failing must not void the panel
// -------------------------------------------
// Live, 2026-09-02: WBD's `structure` answer was truncated mid-`reason` by the
// 300-token cap, so `parseJsonLoose` threw, `Promise.all` rejected, and the
// engine reported `no-ai-backend` — while the backend was answering four other
// symbols in the same run. The two votes already paid for went in the bin.

type Answer = { persona: "trend" | "structure" | "exhaustion"; data: { vote: "long" | "short" | "skip"; confidence: number; reason: string }; costUsd: number };

const ok = (persona: Answer["persona"], vote: Answer["data"]["vote"]): PromiseSettledResult<Answer> => ({
  status: "fulfilled",
  value: { persona, data: { vote, confidence: 0.7, reason: `${persona} says ${vote}` }, costUsd: 0.01 },
});
const failed = (message: string): PromiseSettledResult<Answer> => ({ status: "rejected", reason: new Error(message) });

const TRUNCATED = 'Agent did not return valid JSON: {"vote":"skip","confidence":0.62,"reason":"Price is 74% into a range';

test("countableVotes: a truncated answer abstains instead of voiding the panel", () => {
  const { votes, dropped, totalCostUsd } = countableVotes([ok("trend", "long"), failed(TRUNCATED), ok("exhaustion", "long")]);

  assert.equal(votes.length, 2);
  assert.deepEqual(votes.map((v) => v.persona), ["trend", "exhaustion"]);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /did not return valid JSON/);
  assert.equal(totalCostUsd, 0.02); // only the calls that answered are billed
});

test("countableVotes: a smaller panel is a harder bar, never an easier one", () => {
  // The rule is "two votes on the same side", not "a majority of whoever
  // answered" — so an abstention can only ever cost the setup a confirmation.
  const { votes } = countableVotes([ok("trend", "long"), failed(TRUNCATED), ok("exhaustion", "skip")]);
  assert.equal(votes.filter((v) => v.vote === "long").length, 1); // 1 < 2 → no consensus
});

test("countableVotes: a fatal backend failure still propagates", () => {
  // The opposite case: no analyst can answer. Treating that as an abstention
  // would take the outage latch off exactly when it is needed.
  assert.throws(
    () => countableVotes([ok("trend", "long"), failed("You've hit your monthly spend limit"), ok("exhaustion", "long")]),
    /spend limit/,
  );
});

test("countableVotes: a panel where every analyst failed is an error, not a skip", () => {
  assert.throws(() => countableVotes([failed(TRUNCATED), failed(TRUNCATED), failed(TRUNCATED)]), /every HAWK analyst failed/);
});

// The stored reading and the logged reading must be the same reading
// ------------------------------------------------------------------
// They were built separately at two call sites, and the `Counterfactual` row —
// the one the arm recorder keeps — was the half that dropped the dropped.

test("describePanel: a clean panel reads as just its votes", () => {
  assert.equal(
    describePanel({ votes: [
      { persona: "trend", vote: "long", confidence: 0.7, reason: "" },
      { persona: "structure", vote: "skip", confidence: 0.5, reason: "" },
    ], dropped: [] }),
    "votes trend:long, structure:skip",
  );
});

test("describePanel: a shrunken panel says so, and says why", () => {
  const read = describePanel({
    votes: [{ persona: "exhaustion", vote: "skip", confidence: 0.5, reason: "" }],
    dropped: ["Agent did not return valid JSON", "socket hang up"],
  });
  assert.match(read, /votes exhaustion:skip/);
  assert.match(read, /2 analyst\(s\) dropped/);
  assert.match(read, /socket hang up/);
});

// The stored reading has to answer "why", not just "what"
// -------------------------------------------------------
// `structure` voted skip in 20 of 20 live panels and confirmed 0 times in 75
// votes. The reason string was on the vote object every one of those times and
// was dropped at stringification, so the question could not be answered from
// the database at all.

test("describePanel: the verbose form carries each analyst's confidence and words", () => {
  const read = describePanel(
    {
      votes: [
        { persona: "trend", vote: "long", confidence: 0.72, reason: "MA stack is aligned up" },
        { persona: "structure", vote: "skip", confidence: 0.4, reason: "price is mid-range" },
      ],
      dropped: [],
    },
    { reasons: true },
  );
  assert.match(read, /trend:long@0\.72 "MA stack is aligned up"/);
  assert.match(read, /structure:skip@0\.40 "price is mid-range"/);
});

test("describePanel: the terse form is unchanged when reasons are not asked for", () => {
  const votes = [{ persona: "trend", vote: "long" as const, confidence: 0.72, reason: "MA stack is aligned up" }];
  assert.equal(describePanel({ votes, dropped: [] }), "votes trend:long");
});

test("describePanel: the reason budget is per analyst, so the last one still speaks", () => {
  const long = "x".repeat(4000);
  const read = describePanel(
    {
      votes: [
        { persona: "trend", vote: "long", confidence: 0.5, reason: long },
        { persona: "structure", vote: "skip", confidence: 0.5, reason: long },
        { persona: "exhaustion", vote: "skip", confidence: 0.5, reason: "spent already" },
      ],
      dropped: [],
    },
    { reasons: true },
  );
  assert.match(read, /exhaustion:skip@0\.50 "spent already"/);
  assert.ok(read.length < 1200, `stored reading grew to ${read.length} chars`);
});

test("describePanel: a multi-line reason is stored as one line", () => {
  const read = describePanel(
    { votes: [{ persona: "counter", vote: "skip", confidence: 0.5, reason: "  line one\n\nline two  " }], dropped: [] },
    { reasons: true },
  );
  assert.match(read, /counter:skip@0\.50 "line one line two"/);
});

test("describePanel: dropped analysts survive the verbose form too", () => {
  const read = describePanel(
    { votes: [{ persona: "trend", vote: "long", confidence: 0.6, reason: "ok" }], dropped: ["socket hang up"] },
    { reasons: true },
  );
  assert.match(read, /1 analyst\(s\) dropped: socket hang up/);
});
