import { test } from "node:test";
import assert from "node:assert/strict";
import { isDirectional } from "@/lib/advisor/critiqueContext";
import type { AdvisorCard } from "@/lib/advisor/types";
import type { StopContext } from "@/lib/advisor/chartStop";
import { CHART_PREDICTION_PHRASES_TH } from "@/lib/chartAgent/review";
import {
  SKIP_NOTE_ATR,
  SKIP_NOTE_GIVEN,
  STOP_READING_SCHEMA,
  STOP_READING_SYSTEM,
  STRIPPED_NOTE,
  buildStopReadingPrompt,
  normalizeStopReading,
  skipNoteFor,
} from "@/lib/advisor/stopReading";

const BACKEND = "cli";
const UNREADABLE = "AI ตอบกลับในรูปแบบที่อ่านไม่ได้";
const CLEAN = "stop อยู่ใต้ swing low ที่ถูกแตะครั้งเดียว ไส้เทียนสั้น ใต้ลงไปไม่มีระดับอื่นรองรับ";

// The prompt reads only these fields; the rest of the card is irrelevant to it.
function makeCard(over: Partial<AdvisorCard> = {}): AdvisorCard {
  return {
    ticker: "KO",
    entry: 62.4,
    stop: 61.87,
    atr: 0.9,
    stopAtrMult: 0.59,
    stopSource: "swing",
    stopFlags: [],
    stopNotes: [],
    // 2026-10-30 10:15 ET = 14:15 UTC (EDT)
    stopStructure: { level: 61.95, barT: Date.UTC(2026, 9, 30, 14, 15) / 1000, sessionDate: "2026-10-30" },
    ...over,
  } as AdvisorCard;
}

const T0 = Date.UTC(2026, 9, 30, 14, 10) / 1000; // 10:10 ET
function makeCtx(over: Partial<StopContext> = {}): StopContext {
  return {
    sessionDate: "2026-10-30",
    recent: [
      { t: T0, o: 62.1, h: 62.2, l: 62.0, c: 62.15, v: 1000 },
      { t: T0 + 300, o: 62.15, h: 62.2, l: 61.95, c: 62.1, v: 1200 },
      { t: T0 + 600, o: 62.1, h: 62.5, l: 62.05, c: 62.4, v: 900 },
    ],
    levels: { PDH: 63.1, PDL: 61.5, pVAL: 61.8, pPOC: 62.3, pVAH: 62.9, PMH: null, PML: null, dPOC: null },
    ...over,
  };
}

test("skipNoteFor: atr and given are skipped, swing and pdl are read", () => {
  assert.equal(skipNoteFor("atr"), SKIP_NOTE_ATR);
  assert.equal(skipNoteFor("given"), SKIP_NOTE_GIVEN);
  assert.equal(skipNoteFor("swing"), null);
  assert.equal(skipNoteFor("pdl"), null);
});

test("a clean Thai reading is kept, an empty concern becomes null", () => {
  const out = normalizeStopReading({ reading: `  ${CLEAN}  `, concern: "" }, BACKEND);
  assert.deepEqual(out, { status: "read", reading: CLEAN, concern: null, note: null, backend: BACKEND });
});

test("a concern is kept beside the reading", () => {
  const out = normalizeStopReading({ reading: CLEAN, concern: "ระดับ PDL อยู่ใกล้ใต้ stop มาก" }, BACKEND);
  assert.equal(out.status, "read");
  assert.equal(out.concern, "ระดับ PDL อยู่ใกล้ใต้ stop มาก");
});

test("a reading with an English guard word is stripped", () => {
  const out = normalizeStopReading({ reading: "โครงนี้ bullish ... should hold", concern: "" }, BACKEND);
  assert.deepEqual(out, { status: "stripped", reading: null, concern: null, note: STRIPPED_NOTE, backend: BACKEND });
  const out2 = normalizeStopReading({ reading: "โครงนี้ long ได้", concern: "" }, BACKEND);
  assert.equal(out2.status, "stripped");
});

test("a concern with a Thai prediction phrase strips the whole reading", () => {
  for (const phrase of CHART_PREDICTION_PHRASES_TH) {
    const out = normalizeStopReading({ reading: CLEAN, concern: `ระดับนี้${phrase}` }, BACKEND);
    assert.deepEqual(out, { status: "stripped", reading: null, concern: null, note: STRIPPED_NOTE, backend: BACKEND }, phrase);
  }
});

test("malformed output is unread, never thrown", () => {
  for (const raw of [null, undefined, "x", 3, [], { reading: "  " }, { reading: 5 }, {}]) {
    const out = normalizeStopReading(raw, BACKEND);
    assert.deepEqual(out, { status: "unread", reading: null, concern: null, note: UNREADABLE, backend: BACKEND });
  }
});

test("a missing or non-string concern is null", () => {
  assert.equal(normalizeStopReading({ reading: CLEAN }, BACKEND).concern, null);
  assert.equal(normalizeStopReading({ reading: CLEAN, concern: 7 }, BACKEND).concern, null);
});

test("the prompt carries the stop, its structure and every context level", () => {
  const card = makeCard();
  const p = buildStopReadingPrompt(card, makeCtx());
  assert.ok(p.includes("KO"));
  assert.ok(p.includes(card.stop.toFixed(2)), "stop");
  assert.ok(p.includes(card.entry.toFixed(2)), "entry");
  assert.ok(p.includes("61.95"), "structure level");
  assert.ok(p.includes("10:15"), "structure bar time in ET");
  assert.ok(p.includes("2026-10-30"), "session date");
  assert.ok(p.includes("0.59"), "stopAtrMult");
  for (const name of ["PDH", "PDL", "pVAL", "pPOC", "pVAH"]) assert.ok(p.includes(name), name);
  for (const v of ["63.10", "61.50", "61.80", "62.30", "62.90"]) assert.ok(p.includes(v), v);
  assert.ok(p.includes("10:10"), "bars carry ET times");
});

test("the prompt omits absent levels, a missing structure and a missing levels block", () => {
  const p = buildStopReadingPrompt(
    makeCard({ stopStructure: null }),
    makeCtx({ levels: { PDH: null, PDL: 61.5, pVAL: null, pPOC: null, pVAH: null, PMH: null, PML: null, dPOC: null } }),
  );
  assert.ok(p.includes("PDL 61.50"));
  assert.ok(!p.includes("PDH"));
  const none = buildStopReadingPrompt(makeCard(), makeCtx({ levels: null }));
  assert.ok(none.includes("ไม่มี"));
});

test("the prompt passes the card's flags through", () => {
  const p = buildStopReadingPrompt(makeCard({ stopFlags: ["แคบมาก โดน noise ง่าย"] }), makeCtx());
  assert.ok(p.includes("แคบมาก โดน noise ง่าย"));
});

test("the prompt itself never contains a word the guard strips", () => {
  assert.equal(isDirectional(buildStopReadingPrompt(makeCard(), makeCtx())), false);
});

// The advisor guard strips these English words anywhere in a reading, so the
// system prompt must tell the model never to write them.
const ADVISOR_GUARD_WORDS_EN = [
  "buy", "buying", "sell", "selling", "long", "short", "enter", "entering",
  "avoid", "recommend", "recommendation", "suggest", "should", "worth it", "take this trade",
];

test("the system prompt is Thai and forbids every guard word", () => {
  for (const word of ADVISOR_GUARD_WORDS_EN) {
    assert.ok(isDirectional(`a ${word} here`), `the advisor guard strips ${word}`);
    assert.ok(STOP_READING_SYSTEM.includes(word), `STOP_READING_SYSTEM names ${word}`);
  }
  for (const word of ["ไม่ควร", "แนะนำ"]) assert.ok(STOP_READING_SYSTEM.includes(word), word);
  assert.ok(/[฀-๿]/.test(STOP_READING_SYSTEM));
});

test("the schema asks for a reading and a concern, both strings", () => {
  const s = STOP_READING_SCHEMA as { required: string[]; properties: Record<string, { type: string }> };
  assert.deepEqual([...s.required].sort(), ["concern", "reading"]);
  assert.equal(s.properties.reading.type, "string");
  assert.equal(s.properties.concern.type, "string");
});
