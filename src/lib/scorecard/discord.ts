// The scorecard's morning Discord summary (spec §8, plan Task 6). Plain Thai, fixed
// line order, no prediction words: the message must pass isChartPrediction === false
// (discord.test.ts checks it). Pure.

import type { Group } from "./groups";
import type { LastRunSummary, LiveSnapshot } from "./nightly";
import { SCORECARD_MIN_N, type ExitReason } from "./types";

export interface ClosedLine {
  ticker: string;
  group: Group;
  r: number;
  reason: ExitReason;
}

export interface OpenLine {
  ticker: string;
  group: Group;
  sessionsHeld: number;
}

export interface DiscordInput {
  snapshot: LiveSnapshot;
  lastRun: LastRunSummary;
  sessionDate: string;
  closedOvernight: ClosedLine[];
  openNow: OpenLine[];
}

const REASON: Record<ExitReason, string> = { stop: "โดน stop", t1: "ถึง T1", time: "ครบ 10 วัน" };
const GROUP_TAG: Record<Group, string> = { kept: "", vetoed: " [AI ตัดทิ้ง]", stripped: " [ถูกตัดคำ]", unread: " [AI ไม่ได้อ่าน]" };

const r2 = (x: number) => `${x.toFixed(2)}R`;
const signed = (x: number) => `${x > 0 ? "+" : ""}${r2(x)}`;
/** HH:MM in Thai time (UTC+7, no daylight saving). */
const ictTime = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 16);

export function buildDiscordMessage(input: DiscordInput): string {
  const { snapshot, lastRun, sessionDate, closedOvernight, openNow } = input;
  const lines: string[] = [];

  lines.push(`NEXMIND Scorecard — ${sessionDate}`);

  const extra = [lastRun.unread > 0 ? ` · AI ไม่ได้อ่าน ${lastRun.unread}` : "", lastRun.stripped > 0 ? ` · ถูกตัดคำ ${lastRun.stripped}` : ""].join("");
  lines.push(`setup เมื่อคืน: ${lastRun.setups} ตัว · AI เก็บ ${lastRun.kept} · AI ตัดทิ้ง ${lastRun.vetoed}${extra}`);

  const closed = closedOvernight.map((c) => `${c.ticker} ${signed(c.r)} (${REASON[c.reason]})${GROUP_TAG[c.group]}`);
  lines.push(`ปิดแล้ว: ${closed.length ? closed.join(" · ") : "—"}`);

  const open = openNow.map((o) => `${o.ticker} ${o.sessionsHeld}/10${GROUP_TAG[o.group]}`);
  lines.push(`ยังถือ: ${open.length ? open.join(" · ") : "—"}`);

  const v = snapshot.verdict;
  const p = snapshot.keptProgress;
  // The mean is over closed rows only, so that count is stated; under SCORECARD_MIN_N
  // closed it is not printed (the page does the same). The frozen sample is all closed.
  const mean = v ? v.meanR : p.meanR;
  const closedN = v ? v.n : p.closed;
  const meanText = closedN < SCORECARD_MIN_N || mean === null ? "ยังน้อยเกินไป" : r2(mean);
  lines.push(`สะสม AI เก็บ: ${v ? v.n : p.n}/${p.target} · ปิดแล้ว ${closedN} · เฉลี่ย ${meanText}`);

  // The random control exists only frozen with the verdict; before it there is no number
  // to compare against, and no win/lose word is printed.
  lines.push(v ? `ซื้อสุ่ม p95: ${r2(v.controlP95)} → ${v.pass ? "ชนะ" : "ไม่ชนะ"}` : `ซื้อสุ่ม: คำนวณตอนครบ ${p.target}`);

  lines.push(`สถานะ: ${v ? (v.pass ? "เชื่อได้" : "เชื่อไม่ได้") : "ยังตัดสินไม่ได้"}`);
  // The page's caveat, worded to pass the prediction guard ("รับประกัน" is a guarded phrase).
  if (v) lines.push(v.pass ? "ชนะ p95 ของการซื้อสุ่ม — ไม่ได้พิสูจน์ว่ามี edge" : "ไม่ชนะ p95 ของการซื้อสุ่ม");

  const run =
    lastRun.status === "ran"
      ? `รันแล้ว ${lastRun.ranAt ? ictTime(lastRun.ranAt) : "—"}`
      : lastRun.status === "no_session"
        ? "ไม่มีตลาด"
        : lastRun.status === "failed"
          ? `ล้มเหลว: ${lastRun.error ?? "ไม่ทราบสาเหตุ"}`
          : "ไม่ได้รัน (คอมปิด?)";
  lines.push(`รอบอัตโนมัติเมื่อคืน: ${run}`);

  if (lastRun.aiDown) lines.push("⚠️ AI ไม่ทำงานเมื่อคืน — setup ไม่นับเข้า 300");

  return lines.join("\n");
}
