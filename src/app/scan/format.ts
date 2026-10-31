// Display helpers shared by the scan table and the chart-agent setup panel:
// the owner reads both in Bangkok time, whatever zone the browser is in.

import type { MarketPhase } from "@/lib/scanAgent/types";

export const PHASE_LABEL: Record<MarketPhase, string> = {
  pre: "ก่อนตลาดเปิด",
  open: "ตลาดเปิด",
  closed: "ตลาดปิด — ตัวเลขของวันทำการล่าสุด",
};

const bangkokFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "31 Oct, 20:12" in Thai time, whatever zone the browser is in. */
export function bangkokTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : bangkokFormat.format(d);
}
