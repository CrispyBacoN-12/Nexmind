// Which rows have "something happening" today, and in what order to read them.
// Pure: no I/O, no clock. The score orders rows by activity (how much is moving),
// never by odds; it is a reading order for the owner, not a signal.
//
// Nulls never throw and never become NaN: a missing input fails its trigger
// and counts 0 in the score.

import type { FilingHit } from "@/lib/riskSentry/filingWatch";
import { etDate } from "./session";
import {
  SCAN_GAP_TRIGGER_PCT,
  SCAN_MIN_ATR_PCT,
  SCAN_MIN_AVG_VOLUME,
  SCAN_MIN_PRICE,
  SCAN_PREMARKET_VOLUME_TRIGGER_PCT,
  SCAN_RVOL_TRIGGER,
  type EarningsTag,
  type MarketPhase,
  type Trigger,
  type TvRow,
  type VolumeMetric,
} from "./types";

/** Volume points are capped so one freak print cannot swamp the whole score. */
const VOLUME_POINTS_CAP = 10;
const REPORTED_POINTS = 3;
const RED_FILING_POINTS = 2;
const NOTABLE_FILING_POINTS = 1;

/** Shown on the page footer so the owner can see exactly how rows are ordered. */
export const SCAN_SCORE_FORMULA =
  "คะแนนความเคลื่อนไหว = |gap %| + แต้มวอลุ่ม (rvol สูงสุด 10 หรือ วอลุ่มพรีมาร์เก็ต % ÷ 2 สูงสุด 10) + 3 ถ้าเพิ่งออกงบ + 2 ถ้ามี 8-K สีแดง (หรือ 1 ถ้ามีแค่ข่าวน่าสนใจ) — เรียงตามความเคลื่อนไหว ไม่ใช่ตามโอกาสชนะ";

const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** ATR as a percent of price, or null when either input is unusable. */
export function atrPct(row: TvRow): number | null {
  if (!finite(row.atr) || !finite(row.close) || row.close <= 0) return null;
  return (row.atr / row.close) * 100;
}

/** Liquidity and volatility floors. A null in any checked field fails. */
export function passesBase(row: TvRow): boolean {
  if (row.type !== "stock") return false;
  if (!finite(row.close) || row.close < SCAN_MIN_PRICE) return false;
  if (!finite(row.avgVolume10d) || row.avgVolume10d < SCAN_MIN_AVG_VOLUME) return false;
  const a = atrPct(row);
  return a !== null && a >= SCAN_MIN_ATR_PCT;
}

/**
 * "reported": results landed in the window the market is still digesting
 * (this session before the open or time unknown, or the previous session
 * after the close). "tonight": results due after today's close, which is
 * context only and never a trigger.
 */
export function earningsTag(
  row: TvRow,
  dates: { session: string; previous: string },
): EarningsTag {
  if (finite(row.earningsLastAt)) {
    const d = etDate(row.earningsLastAt);
    const t = row.earningsLastTime;
    if (d === dates.session && (t === -1 || t === 0)) return "reported";
    if (d === dates.previous && t === 1) return "reported";
  }
  if (finite(row.earningsNextAt) && row.earningsNextTime === 1) {
    if (etDate(row.earningsNextAt) === dates.session) return "tonight";
  }
  return null;
}

/** Pre-market change before the bell, the open gap once the session is under way. */
export function gapFor(row: TvRow, phase: MarketPhase): number | null {
  const v = phase === "pre" ? row.premarketChangePct : row.gapPct;
  return finite(v) ? v : null;
}

export function volumeFor(row: TvRow, phase: MarketPhase): VolumeMetric {
  if (phase === "pre") {
    const pv = row.premarketVolume;
    const avg = row.avgVolume10d;
    const value = finite(pv) && finite(avg) && avg > 0 ? (pv / avg) * 100 : null;
    return { kind: "premarketPct", value };
  }
  const v = phase === "open" ? row.rvolIntraday : row.rvol10d;
  return { kind: "rvol", value: finite(v) ? v : null };
}

export function triggersFor(
  row: TvRow,
  phase: MarketPhase,
  tag: EarningsTag,
): Trigger[] {
  const out: Trigger[] = [];

  const gap = gapFor(row, phase);
  if (gap !== null && Math.abs(gap) >= SCAN_GAP_TRIGGER_PCT) out.push("gap");

  const vol = volumeFor(row, phase);
  if (vol.value !== null) {
    const limit =
      vol.kind === "rvol" ? SCAN_RVOL_TRIGGER : SCAN_PREMARKET_VOLUME_TRIGGER_PCT;
    if (vol.value >= limit) out.push("volume");
  }

  // "tonight" is context for the reader; only a report that already happened counts.
  if (tag === "reported") out.push("earnings");

  return out;
}

export function activityScore(
  gapPct: number | null,
  volume: VolumeMetric,
  tag: EarningsTag,
  filings: FilingHit[],
): number {
  const gapPoints = finite(gapPct) ? Math.abs(gapPct) : 0;

  let volumePoints = 0;
  if (finite(volume.value)) {
    const raw = volume.kind === "rvol" ? volume.value : volume.value / 2;
    volumePoints = Math.min(Math.max(raw, 0), VOLUME_POINTS_CAP);
  }

  const earningsPoints = tag === "reported" ? REPORTED_POINTS : 0;

  const filingPoints = filings.some((f) => f.tier === "red")
    ? RED_FILING_POINTS
    : filings.some((f) => f.tier === "notable")
      ? NOTABLE_FILING_POINTS
      : 0;

  return gapPoints + volumePoints + earningsPoints + filingPoints;
}
