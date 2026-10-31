// The AI's read of each code-found long setup: a 2-3 line Thai chart reading,
// and the right to reject a setup whose structure reads poor.
//
// The model never changes a number. Levels, entry, stop, targets and R are
// computed in code and only shown to it. Its reply is checked anyway: a reading
// that predicts or claims odds is dropped and the setup says so ("ตัดออก:
// มีคำทำนาย"), because a prompt is a request and a guard is a guarantee.
//
// Impure (spawns a subprocess through anthropic.ts), so only isChartPrediction,
// buildReviewPrompt and normalizeReviews are unit-tested. reviewSetups NEVER
// throws: the setups are complete without the readings.

import { isDirectional } from "@/lib/advisor/critiqueContext";
import { aiBackend, aiOutageReason, callAgentJSON } from "@/lib/anthropic";
import type { Candle } from "@/lib/indicators";
import { safeFailureReason } from "@/lib/scanAgent/annotate";
import { etClock } from "@/lib/scanAgent/session";
import { CHART_AI_BARS, type Setup } from "@/lib/chartAgent/types";

export type ReviewStatus = "kept" | "rejected" | "stripped" | "unread";

export interface Review {
  status: ReviewStatus;
  reading: string | null;
  reason: string | null;
}

export interface ReviewItem {
  setup: Setup;
  /** The last CHART_AI_BARS regular 5-minute bars, oldest first. */
  recent: Candle[];
}

const STRIPPED_REASON = "ตัดออก: มีคำทำนาย";
const NO_REASON = "AI ตัดออกโดยไม่ให้เหตุผลที่แสดงได้";
const UNREAD_REASON = "AI ไม่ได้อ่าน";
const RAW_WITHHELD_REASON = "อ่านคำตอบของ AI ไม่ได้ (ข้อความดิบถูกตัดออก)";

/**
 * What the chart prompt forbids that the advisor's guard does not catch:
 * predictions and claims of odds or certainty. Plain substrings, because Thai
 * has no word boundaries.
 */
export const CHART_PREDICTION_PHRASES_TH: readonly string[] = [
  "จะขึ้น",
  "จะลง",
  "น่าจะขึ้น",
  "น่าจะลง",
  "แน่นอน",
  "โอกาสสูง",
  "การันตี",
  "รับประกัน",
  "ชัวร์",
  "กำไรแน่",
];

/** The advisor's guard plus the chart-only phrases above. */
export function isChartPrediction(text: string): boolean {
  return isDirectional(text) || CHART_PREDICTION_PHRASES_TH.some((p) => text.includes(p));
}

export const REVIEW_SYSTEM =
  "คุณเป็นเทรดเดอร์ที่อ่านกราฟ 5 นาทีของหุ้นสหรัฐ ระบบโค้ดหา setup ฝั่งซื้อ (long) จากการกวาดสภาพคล่อง (liquidity sweep) ให้แล้ว " +
  `ระดับราคา จุดเข้า จุดตัดขาดทุน และเป้าหมายทุกตัวคำนวณโดยโค้ด ข้อมูลแต่ละ setup ประกอบด้วยระดับราคา แท่งที่กวาด และแท่งล่าสุดไม่เกิน ${CHART_AI_BARS} แท่ง (เวลาเป็น ET) ` +
  "งานของคุณ: อธิบายโครงสร้างของแต่ละตัวแบบเทรดเดอร์ 2-3 บรรทัดเป็นภาษาไทย เช่น แท่งที่กวาดปิดกลับมาอย่างไร แรงซื้อหลังกวาดเป็นอย่างไร ราคาอยู่ตรงไหนเทียบกับระดับสำคัญ " +
  "คุณปฏิเสธ setup ที่โครงสร้างอ่านแล้วไม่ดีได้ (keep เป็น false) และต้องให้เหตุผลเป็นภาษาไทยใน rejectReason ถ้าเก็บไว้ให้ rejectReason เป็นสตริงว่าง " +
  "ห้ามทำนายทิศทางราคา ห้ามบอกโอกาสหรือความแน่นอน ห้ามแนะนำซื้อ ขาย หรือถือ ห้ามเปลี่ยนตัวเลขใดๆ และห้ามเสนอระดับราคาใหม่ " +
  'ตอบเป็น JSON เท่านั้น: {"reviews":[{"ticker","keep","reading","rejectReason"}]} ให้ครบทุกตัวที่ส่งไป';

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          keep: { type: "boolean" },
          reading: { type: "string" },
          rejectReason: { type: "string" },
        },
        required: ["ticker", "keep", "reading", "rejectReason"],
      },
    },
  },
  required: ["reviews"],
};

function hhmm(epochSec: number): string {
  const { minutes } = etClock(epochSec);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function p2(n: number): string {
  return n.toFixed(2);
}

function ohlc(c: Candle): string {
  return `o ${p2(c.o)} h ${p2(c.h)} l ${p2(c.l)} c ${p2(c.c)}`;
}

function block({ setup: s, recent }: ReviewItem): string {
  const levels = Object.entries(s.levels)
    .filter((e): e is [string, number] => e[1] !== null)
    .map(([name, price]) => `${name} ${p2(price)}`)
    .join(", ");
  const lines = [
    `## ${s.ticker}`,
    `ระดับราคา: ${levels || "ไม่มี"}`,
    `ระดับที่ถูกกวาด: ${s.sweptLevels.join(", ")}`,
    `แท่งที่กวาด ${hhmm(s.sweepBar.t)} ET: ${ohlc(s.sweepBar)}`,
    `entry ${p2(s.entry)}, stop ${p2(s.stop)}`,
    `T1 ${p2(s.t1.price)} (${s.t1.names.join("+")}) ${p2(s.t1.r)}R`,
  ];
  if (s.t2) lines.push(`T2 ${p2(s.t2.price)} (${s.t2.names.join("+")}) ${p2(s.t2.r)}R`);
  lines.push("แท่งล่าสุด (ET HH:MM o h l c v):");
  for (const c of recent) {
    lines.push(`${hhmm(c.t)} ${p2(c.o)} ${p2(c.h)} ${p2(c.l)} ${p2(c.c)} ${c.v}`);
  }
  return lines.join("\n");
}

export function buildReviewPrompt(items: ReviewItem[]): string {
  return items.map(block).join("\n\n");
}

function unread(tickers: string[]): Map<string, Review> {
  const out = new Map<string, Review>();
  for (const t of tickers) out.set(t, { status: "unread", reading: null, reason: UNREAD_REASON });
  return out;
}

/**
 * Turn whatever came back into one review per requested ticker, running the
 * prediction guard on every reading and every rejection reason. A reading that
 * trips the guard is stripped even if the model also rejected the setup.
 * Exported for the tests.
 */
export function normalizeReviews(raw: unknown, tickers: string[]): Map<string, Review> {
  const wanted = new Set(tickers);
  const answered = new Map<string, { keep: boolean; reading: string; reason: string }>();
  const list =
    raw != null && typeof raw === "object" && Array.isArray((raw as { reviews?: unknown }).reviews)
      ? (raw as { reviews: unknown[] }).reviews
      : [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.ticker !== "string" || typeof row.keep !== "boolean") continue;
    const ticker = row.ticker.trim().toUpperCase();
    if (!wanted.has(ticker) || answered.has(ticker)) continue;
    answered.set(ticker, {
      keep: row.keep,
      reading: typeof row.reading === "string" ? row.reading.trim() : "",
      reason: typeof row.rejectReason === "string" ? row.rejectReason.trim() : "",
    });
  }

  const out = unread(tickers);
  for (const t of tickers) {
    const a = answered.get(t);
    if (a === undefined) continue;
    const reading = a.reading === "" ? null : a.reading;
    if (reading !== null && isChartPrediction(reading)) {
      out.set(t, { status: "stripped", reading: null, reason: STRIPPED_REASON });
    } else if (!a.keep) {
      const reason = a.reason === "" || isChartPrediction(a.reason) ? NO_REASON : a.reason;
      out.set(t, { status: "rejected", reading, reason });
    } else {
      out.set(t, { status: "kept", reading, reason: null });
    }
  }
  return out;
}

export async function reviewSetups(
  items: ReviewItem[],
): Promise<{ reviews: Map<string, Review>; backend: string; note: string | null }> {
  const tickers = items.map((i) => i.setup.ticker);
  const backend = aiBackend();
  if (items.length === 0) return { reviews: new Map(), backend, note: null };
  if (backend === "mock") {
    return { reviews: unread(tickers), backend, note: aiOutageReason() ?? "no AI backend" };
  }
  try {
    const r = await callAgentJSON<unknown>({
      tier: "sonnet",
      label: "chart-agent",
      system: REVIEW_SYSTEM,
      prompt: buildReviewPrompt(items),
      maxTokens: 3000,
      jsonSchema: REVIEW_SCHEMA,
    });
    return { reviews: normalizeReviews(r.data, tickers), backend, note: null };
  } catch (err) {
    const safe = safeFailureReason(err);
    if (safe === RAW_WITHHELD_REASON) {
      console.error("chart-agent: withholding raw model text from the page:", err instanceof Error ? err.message : String(err));
    }
    return { reviews: unread(tickers), backend, note: safe };
  }
}
