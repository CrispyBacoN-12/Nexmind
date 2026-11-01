// The AI's short Thai description of the chart stop /advisor found: what the
// stop sits under and how clean that structure is. It never changes a number.
// The stop, entry and every level are computed in code and only shown to the
// model; the card is complete without this reading.
//
// Same stance as chartAgent/review.ts: a prompt is a request and a guard is a
// guarantee, so a reading (or concern) that predicts, calls an entry or exit, or
// trips the advisor's directional guard is dropped whole and the card says so.
//
// Pure: stopReader.ts spawns the CLI, this file only builds the prompt and
// checks what came back.

import type { StopContext } from "@/lib/advisor/chartStop";
import type { AdvisorCard } from "@/lib/advisor/types";
import { isChartPrediction } from "@/lib/chartAgent/review";
import type { LevelName } from "@/lib/chartAgent/types";
import { etClock } from "@/lib/scanAgent/session";

export type StopReadingStatus = "read" | "stripped" | "unread" | "skipped";

export interface StopReading {
  status: StopReadingStatus;
  reading: string | null;
  /** One-line worry the AI may add; null when it had none. */
  concern: string | null;
  /** Thai note shown when there is no reading (skipped, stripped, unread). */
  note: string | null;
  backend: string;
}

export const SKIP_NOTE_ATR = "stop นี้ไม่ได้มาจากโครงกราฟ จึงไม่มีอะไรให้อ่าน";
export const SKIP_NOTE_GIVEN = "stop นี้กำหนดมาเอง (จากป๊อปอัป agent กราฟหรือพิมพ์เอง) จึงไม่ได้ให้ AI อ่านซ้ำ";
export const STRIPPED_NOTE = "คำอ่านของ AI ถูกตัดออก เพราะมีคำทำนายหรือคำแนะนำซื้อขาย";
export const UNREADABLE_NOTE = "AI ตอบกลับในรูปแบบที่อ่านไม่ได้";

/** Only structural stops (swing, PDL) are read; the ATR rule and a given stop are not. */
export function skipNoteFor(source: AdvisorCard["stopSource"]): string | null {
  if (source === "atr") return SKIP_NOTE_ATR;
  if (source === "given") return SKIP_NOTE_GIVEN;
  return null;
}

export const STOP_READING_SYSTEM =
  "คุณเป็นเทรดเดอร์ที่อ่านกราฟ 5 นาทีของหุ้นสหรัฐ ระบบโค้ดหาจุด stop ฝั่งซื้อจากโครงกราฟให้แล้ว " +
  "ราคาเข้า stop และระดับราคาทุกตัวคำนวณโดยโค้ด ข้อมูลที่ส่งให้ประกอบด้วย ticker ราคาเข้า stop โครงสร้างที่ stop อยู่ใต้ (ระดับ แท่ง และเวลา ET) ATR ระดับสำคัญ และแท่ง 5 นาทีล่าสุด " +
  "งานของคุณ: เขียนเป็นภาษาไทย 2-4 ประโยค ว่า stop นี้อยู่ใต้อะไร และโครงสร้างนั้นสะอาดแค่ไหน เช่น ถูกแตะครั้งเดียวหรือหลายครั้ง " +
  "เป็นไส้เทียนลึกหรือแค่ย่อตื้นๆ มีระดับราคาอื่นอยู่ใต้ลงไปติดๆ หรือไม่ และจุดกลับตัวนั้นเก่ากี่แท่งแล้ว " +
  "ถ้ามีข้อกังวลอย่างเดียวที่สำคัญ ใส่ใน concern เป็นประโยคเดียว ถ้าไม่มีให้ concern เป็นสตริงว่าง " +
  "ห้ามทำนายทิศทางราคา ห้ามบอกโอกาสหรือความน่าจะเป็น ห้ามบอกว่าควรเข้าหรือออก ห้ามเสนอราคา stop ใหม่ ห้ามแนะนำซื้อ ขาย หรือถือ และห้ามเปลี่ยนตัวเลขใดๆ " +
  "เขียนเป็นภาษาไทยล้วน ห้ามใช้คำอังกฤษ buy, buying, sell, selling, long, short, enter, entering, avoid, recommend, recommendation, suggest, should, worth it, take this trade และห้ามใช้คำว่า ไม่ควร หรือ แนะนำ " +
  "เพราะระบบจะลบคำอ่านทั้งก้อนที่มีคำเหล่านี้ทิ้ง (ชื่อระดับราคาอย่าง PDL, VAL และคำว่า swing low ใช้ได้) " +
  'ตอบเป็น JSON เท่านั้น: {"reading":string,"concern":string}';

/** concern is "" when the model has none (an optional property is awkward for strict schemas). */
export const STOP_READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reading: { type: "string" },
    concern: { type: "string" },
  },
  required: ["reading", "concern"],
};

const SOURCE_LABEL: Record<AdvisorCard["stopSource"], string> = {
  given: "stop ที่กำหนดมา",
  swing: "ใต้ swing low ของกราฟ 5 นาที",
  pdl: "ใต้ PDL (ต่ำสุดของวันก่อน)",
  atr: "กฎ ATR",
};

const LEVEL_ORDER: readonly LevelName[] = ["PDH", "PDL", "pVAL", "pPOC", "pVAH"];

const p2 = (n: number): string => n.toFixed(2);

function hhmm(epochSec: number): string {
  const { minutes } = etClock(epochSec);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function buildStopReadingPrompt(card: AdvisorCard, ctx: StopContext): string {
  const lines = [
    `## ${card.ticker}`,
    `entry ${p2(card.entry)}, stop ${p2(card.stop)}`,
    `ที่มาของ stop: ${SOURCE_LABEL[card.stopSource]}`,
  ];

  const s = card.stopStructure;
  if (s) {
    const after = ctx.recent.filter((c) => c.t > s.barT).length;
    const where = ctx.recent.some((c) => c.t === s.barT)
      ? `, มีแท่งตามหลังมา ${after} แท่ง`
      : ", แท่งนี้อยู่นอกช่วงแท่งล่าสุดที่แสดง";
    lines.push(`โครงสร้าง: ระดับ ${p2(s.level)} จากแท่งเวลา ${hhmm(s.barT)} ET วันที่ ${s.sessionDate}${where}`);
  }

  lines.push(`ATR14 รายวัน ${p2(card.atr)}, ระยะ stop = ${p2(card.stopAtrMult)} x ATR`);
  if (card.stopFlags.length > 0) lines.push(`ข้อสังเกตของระบบ: ${card.stopFlags.join(" / ")}`);

  const levels = LEVEL_ORDER.flatMap((name) => {
    const v = ctx.levels?.[name];
    return v == null ? [] : [`${name} ${p2(v)}`];
  });
  lines.push(`ระดับราคา: ${levels.length > 0 ? levels.join(", ") : "ไม่มี"}`);

  lines.push(`แท่ง 5 นาทีของวันที่ ${ctx.sessionDate} (ET HH:MM o h l c):`);
  for (const c of ctx.recent) {
    const mark = s && c.t === s.barT ? "  <- แท่งของระดับ stop" : "";
    lines.push(`${hhmm(c.t)} ${p2(c.o)} ${p2(c.h)} ${p2(c.l)} ${p2(c.c)}${mark}`);
  }
  return lines.join("\n");
}

function unread(backend: string): StopReading {
  return { status: "unread", reading: null, concern: null, note: UNREADABLE_NOTE, backend };
}

/**
 * Turn whatever came back into a StopReading, running the prediction guard on
 * the reading and the concern. One tripped field strips both: a reading beside a
 * concern that predicts is not a reading we stand behind. Never throws.
 */
export function normalizeStopReading(raw: unknown, backend: string): StopReading {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return unread(backend);
  const row = raw as Record<string, unknown>;
  const reading = typeof row.reading === "string" ? row.reading.trim() : "";
  if (reading === "") return unread(backend);
  const concern = typeof row.concern === "string" ? row.concern.trim() : "";
  if (isChartPrediction(reading) || isChartPrediction(concern)) {
    return { status: "stripped", reading: null, concern: null, note: STRIPPED_NOTE, backend };
  }
  return { status: "read", reading, concern: concern === "" ? null : concern, note: null, backend };
}
