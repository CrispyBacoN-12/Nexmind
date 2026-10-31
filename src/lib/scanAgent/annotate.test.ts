import { test } from "node:test";
import assert from "node:assert/strict";
import { ANNOTATE_SYSTEM, buildAnnotatePrompt, normalizeNotes } from "@/lib/scanAgent/annotate";

test("a clean note is kept", () => {
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "งบออกเช้านี้ gap +3%" }] }, ["KO"]);
  assert.deepEqual(out.get("KO"), { note: "งบออกเช้านี้ gap +3%", reason: null });
});

test("a directional note is stripped with a visible reason", () => {
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "You should buy this here" }] }, ["KO"]);
  assert.deepEqual(out.get("KO"), { note: null, reason: "ตัดออก: มีคำชี้นำ" });
});

test("a Thai directional note is stripped too", () => {
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "ราคานี้ไม่ควรเข้า" }] }, ["KO"]);
  assert.deepEqual(out.get("KO"), { note: null, reason: "ตัดออก: มีคำชี้นำ" });
});

test("a skipped ticker gets a reason", () => {
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "gap +3% หลังงบ" }] }, ["KO", "AAPL"]);
  assert.equal(out.get("KO")?.reason, null);
  assert.deepEqual(out.get("AAPL"), { note: null, reason: "AI ไม่ได้ตอบตัวนี้" });
});

test("unknown tickers are ignored", () => {
  const out = normalizeNotes({ notes: [{ ticker: "ZZZZ", note: "gap +3%" }] }, ["KO"]);
  assert.equal(out.has("ZZZZ"), false);
  assert.equal(out.size, 1);
});

test("malformed shapes never throw", () => {
  for (const raw of ["garbage", null, undefined, 42, { notes: "x" }, { notes: [{ ticker: 5 }] }, { notes: [null, 3] }]) {
    const out = normalizeNotes(raw, ["KO"]);
    assert.equal(out.get("KO")?.note, null);
    assert.ok(out.get("KO")?.reason);
  }
});

test("an empty or non-string note counts as not answered", () => {
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "   " }] }, ["KO"]);
  assert.deepEqual(out.get("KO"), { note: null, reason: "AI ไม่ได้ตอบตัวนี้" });
});

test("the prompt carries every ticker with its facts, and the system forbids advice", () => {
  const p = buildAnnotatePrompt([
    { ticker: "KO", facts: "gap +3.1%" },
    { ticker: "AAPL", facts: "rvol 2.4" },
  ]);
  assert.match(p, /KO: gap \+3\.1%/);
  assert.match(p, /AAPL: rvol 2\.4/);
  assert.match(ANNOTATE_SYSTEM, /notes/);
});
