// One or two Thai lines per scanned stock saying what is happening today.
//
// The note describes, it never advises. The model is told so, and then the
// reply is checked anyway: every note passes isDirectional before it can reach
// the page, because a prompt is a request and a guard is a guarantee. A note
// that trips the guard is dropped and the row says so ("ตัดออก: มีคำชี้นำ"), it
// is never silently blank.
//
// Impure (spawns a subprocess through anthropic.ts), so only normalizeNotes and
// buildAnnotatePrompt are unit-tested. annotateRows NEVER throws: the scan is
// complete without the notes.

import { isDirectional } from "@/lib/advisor/critiqueContext";
import { aiBackend, aiOutageReason, callAgentJSON } from "@/lib/anthropic";
import { SCAN_AI_BATCH, type SourceStatus } from "@/lib/scanAgent/types";

export interface AnnotateInput {
  ticker: string;
  /** One line of numbers, tags, 8-K labels and up to 3 headlines (built by the orchestrator). */
  facts: string;
}

export interface NoteOutcome {
  note: string | null;
  reason: string | null;
}

const SOURCE_NAME = "AI";
const STRIPPED_REASON = "ตัดออก: มีคำชี้นำ";
const MISSING_REASON = "AI ไม่ได้ตอบตัวนี้";
const UNAVAILABLE_PREFIX = "AI ใช้ไม่ได้: ";
const RAW_WITHHELD_REASON = "อ่านคำตอบของ AI ไม่ได้ (ข้อความดิบถูกตัดออก)";

export const ANNOTATE_SYSTEM =
  "คุณช่วยสรุปหุ้นให้เจ้าของพอร์ตอ่านตอนก่อนตลาดเปิด/ช่วงเปิดตลาด " +
  "ข้อมูลแต่ละตัวอยู่ในบรรทัดเดียว: ตัวเลข ป้ายกำกับ ป้าย 8-K และพาดหัวข่าวไม่เกิน 3 ข้อ " +
  "ให้เขียนโน้ตภาษาไทย 1-2 บรรทัดต่อหุ้นหนึ่งตัว บอกว่า 'วันนี้เกิดอะไรขึ้น' " +
  "และข้อควรระวังของข้อมูล (เช่น ข่าวไม่ครบ ตัวเลขยังไม่นิ่ง) โดยอ้างเฉพาะข้อมูลที่ให้มาเท่านั้น " +
  "ห้ามเดาหรือเติมข้อเท็จจริงที่ไม่อยู่ในข้อมูล " +
  "ห้ามแนะนำซื้อ ขาย หรือถือ ห้ามทำนายทิศทางราคา ห้ามจัดอันดับ " +
  'ห้ามบอกว่าตัวไหน "น่าสนใจที่สุด" หรือ "ตัวเด่น" เพราะระบบนี้ไม่มีหลักฐานว่ามีความได้เปรียบ ' +
  'ตอบเป็น JSON เท่านั้น: {"notes":[{"ticker","note"}]} ให้ครบทุกตัวที่ส่งไป';

const ANNOTATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          note: { type: "string" },
        },
        required: ["ticker", "note"],
      },
    },
  },
  required: ["notes"],
};

export function buildAnnotatePrompt(inputs: AnnotateInput[]): string {
  return inputs.map((i) => `${i.ticker}: ${i.facts}`).join("\n");
}

/**
 * Turn whatever came back into one outcome per requested ticker, running the
 * directional guard on every note. Exported for the tests.
 */
export function normalizeNotes(raw: unknown, tickers: string[]): Map<string, NoteOutcome> {
  const wanted = new Set(tickers);
  const answered = new Map<string, string>();
  const list =
    raw != null && typeof raw === "object" && Array.isArray((raw as { notes?: unknown }).notes)
      ? ((raw as { notes: unknown[] }).notes)
      : [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.ticker !== "string" || typeof row.note !== "string") continue;
    const ticker = row.ticker.trim().toUpperCase();
    const note = row.note.trim();
    if (!wanted.has(ticker) || note === "" || answered.has(ticker)) continue;
    answered.set(ticker, note);
  }
  const out = new Map<string, NoteOutcome>();
  for (const t of tickers) {
    const note = answered.get(t);
    if (note === undefined) out.set(t, { note: null, reason: MISSING_REASON });
    else if (isDirectional(note)) out.set(t, { note: null, reason: STRIPPED_REASON });
    else out.set(t, { note, reason: null });
  }
  return out;
}

function unavailable(inputs: AnnotateInput[], why: string): Map<string, NoteOutcome> {
  const out = new Map<string, NoteOutcome>();
  for (const i of inputs) out.set(i.ticker, { note: null, reason: UNAVAILABLE_PREFIX + why });
  return out;
}

export async function annotateRows(
  inputs: AnnotateInput[],
): Promise<{ notes: Map<string, NoteOutcome>; status: SourceStatus }> {
  if (inputs.length === 0) {
    return { notes: new Map(), status: { name: SOURCE_NAME, ok: true, note: "ไม่มีแถวให้สรุป" } };
  }
  if (aiBackend() === "mock") {
    const why = aiOutageReason() ?? "no AI backend";
    return {
      notes: unavailable(inputs, why),
      status: { name: SOURCE_NAME, ok: false, note: UNAVAILABLE_PREFIX + why },
    };
  }

  const notes = new Map<string, NoteOutcome>();
  let failed = 0;
  let firstFailure = "";
  for (let i = 0; i < inputs.length; i += SCAN_AI_BATCH) {
    const batch = inputs.slice(i, i + SCAN_AI_BATCH);
    try {
      const r = await callAgentJSON<unknown>({
        tier: "haiku",
        label: "scan-agent",
        system: ANNOTATE_SYSTEM,
        prompt: buildAnnotatePrompt(batch),
        maxTokens: 1500,
        jsonSchema: ANNOTATE_SCHEMA,
      });
      for (const [t, o] of normalizeNotes(r.data, batch.map((b) => b.ticker))) notes.set(t, o);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // parseJsonLoose's error embeds a slice of the model's raw prose. If the
      // model broke its contract and said something directional, forwarding it
      // would bypass the guard, so those reasons are replaced with a fixed note.
      const safe =
        message.startsWith("Agent did not return valid JSON") || isDirectional(message)
          ? RAW_WITHHELD_REASON
          : message;
      if (safe === RAW_WITHHELD_REASON) {
        console.error("scan-agent: withholding raw model text from the page:", message);
      }
      failed++;
      if (firstFailure === "") firstFailure = safe;
      for (const [t, o] of unavailable(batch, safe)) notes.set(t, o);
    }
  }

  if (failed === 0) {
    const answered = [...notes.values()].filter((o) => o.note !== null).length;
    return {
      notes,
      status: { name: SOURCE_NAME, ok: true, note: `สรุปได้ ${answered}/${inputs.length} แถว` },
    };
  }
  return {
    notes,
    status: { name: SOURCE_NAME, ok: false, note: UNAVAILABLE_PREFIX + firstFailure },
  };
}
