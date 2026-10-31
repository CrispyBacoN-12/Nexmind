// Volume-profile and session levels for the chart agent: the previous
// session's POC/VAH/VAL and high/low, the pre-market high/low and today's
// developing POC. These are the lines the setup rule sweeps and targets, so
// they are computed here in code and never left to the AI.

import { volumeProfile, type Candle } from "@/lib/indicators";
import { CHART_PROFILE_BINS, CHART_VALUE_AREA } from "./types";
import type { Levels, SessionSplit } from "./types";

/** Profile over every bar of a session; null on a flat range. */
function sessionProfile(candles: Candle[]) {
  return volumeProfile(
    candles,
    candles.length - 1,
    candles.length,
    CHART_PROFILE_BINS,
    CHART_VALUE_AREA,
  );
}

export function computeLevels(
  split: SessionSplit,
): { levels: Levels } | { error: string } {
  const { previous, premarket, regular } = split;
  if (previous.length === 0) return { error: "ไม่มีวันทำการก่อนหน้า" };

  const prevProfile = sessionProfile(previous);
  if (!prevProfile) return { error: "profile เมื่อวานคำนวณไม่ได้" };

  const dayProfile = regular.length >= 2 ? sessionProfile(regular) : null;

  return {
    levels: {
      pPOC: prevProfile.poc,
      pVAH: prevProfile.vah,
      pVAL: prevProfile.val,
      PDH: Math.max(...previous.map((c) => c.h)),
      PDL: Math.min(...previous.map((c) => c.l)),
      PMH: premarket.length > 0 ? Math.max(...premarket.map((c) => c.h)) : null,
      PML: premarket.length > 0 ? Math.min(...premarket.map((c) => c.l)) : null,
      dPOC: dayProfile ? dayProfile.poc : null,
    },
  };
}
