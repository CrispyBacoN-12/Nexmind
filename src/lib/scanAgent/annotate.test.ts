import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNOTATE_SYSTEM,
  SCAN_DIRECTIONAL_PHRASES_TH,
  buildAnnotatePrompt,
  isScanDirectional,
  normalizeNotes,
  safeFailureReason,
} from "@/lib/scanAgent/annotate";

const WITHHELD = "อ่านคำตอบของ AI ไม่ได้ (ข้อความดิบถูกตัดออก)";

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

test("the system prompt keeps its forbid clauses", () => {
  assert.ok(ANNOTATE_SYSTEM.includes("ห้ามแนะนำซื้อ ขาย หรือถือ"));
  assert.ok(ANNOTATE_SYSTEM.includes("ห้ามทำนายทิศทางราคา"));
  assert.ok(ANNOTATE_SYSTEM.includes("ห้ามจัดอันดับ"));
  assert.ok(ANNOTATE_SYSTEM.includes("ห้ามเดาหรือเติมข้อเท็จจริง"));
});

test("every scan-only phrase is flagged, alone and inside a sentence", () => {
  assert.equal(SCAN_DIRECTIONAL_PHRASES_TH.length, 14);
  for (const p of SCAN_DIRECTIONAL_PHRASES_TH) {
    assert.equal(isScanDirectional(p), true, p);
    assert.equal(isScanDirectional(`วันนี้ ${p} ตามข่าว`), true, p);
    const out = normalizeNotes({ notes: [{ ticker: "KO", note: `ข่าวออกเช้านี้ ${p}` }] }, ["KO"]);
    assert.deepEqual(out.get("KO"), { note: null, reason: "ตัดออก: มีคำชี้นำ" }, p);
  }
});

test("the advisor guard still applies through the scan guard", () => {
  assert.equal(isScanDirectional("You should buy this"), true);
  assert.equal(isScanDirectional("ควรซื้อ"), true);
});

test("ordinary Thai market words are not stripped (no bare ซื้อ / ขาย)", () => {
  for (const ok of ["ยอดขายลดลง", "แรงขายหนัก", "แรงซื้อเข้ามา", "gap +3% หลังงบ วอลุ่ม 2.4 เท่า"]) {
    assert.equal(isScanDirectional(ok), false, ok);
  }
  const out = normalizeNotes({ notes: [{ ticker: "KO", note: "ยอดขายลดลง แรงขายหนัก" }] }, ["KO"]);
  assert.equal(out.get("KO")?.note, "ยอดขายลดลง แรงขายหนัก");
});

test("safeFailureReason: a SyntaxError is withheld, even one quoting model prose", () => {
  const v8 = new SyntaxError(`Unexpected token 'ห', ..."te":"x"}, หุ้นจะขึ้น"... is not valid JSON`);
  assert.equal(safeFailureReason(v8), WITHHELD);
  // and a SyntaxError whose text looks harmless is still withheld: it may quote the model
  assert.equal(safeFailureReason(new SyntaxError("Unexpected end of JSON input")), WITHHELD);
});

test("safeFailureReason: parseJsonLoose's own error is withheld", () => {
  assert.equal(safeFailureReason(new Error("Agent did not return valid JSON: ตัวนี้ดี")), WITHHELD);
});

test("safeFailureReason: a message the scan guard flags is withheld", () => {
  assert.equal(safeFailureReason(new Error("upstream said: เข้าซื้อ KO")), WITHHELD);
  assert.equal(safeFailureReason(new Error("you should buy")), WITHHELD);
  assert.equal(safeFailureReason("ราคาเป้าหมาย 100"), WITHHELD);
});

test("safeFailureReason: real backend errors pass through", () => {
  for (const m of ["spend limit reached for this month", "timeout after 90000ms", "OAuth token expired"]) {
    assert.equal(safeFailureReason(new Error(m)), m);
  }
  assert.equal(safeFailureReason("plain string failure"), "plain string failure");
});
