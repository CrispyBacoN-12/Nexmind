// Pure: does the market-gate reading differ from the last recorded one? Fires
// on a flip only, never every run — see design spec §2.2 on why a daily
// "still above SMA200" ping is alert fatigue, not a useful signal.

import type { GateDecision } from "@/lib/market/marketGate";

export type GateReading = "above" | "below" | "unknown";

export interface MarketGateAlertResult {
  flipped: boolean;
  from: GateReading;
  to: GateReading;
  note: string;
}

function toReading(benchAbove: boolean | null): GateReading {
  return benchAbove == null ? "unknown" : benchAbove ? "above" : "below";
}

export function marketGateAlert(gate: GateDecision, lastReading: GateReading): MarketGateAlertResult {
  const to = toReading(gate.benchAbove);
  const flipped = lastReading !== "unknown" && to !== "unknown" && lastReading !== to;
  const note = flipped
    ? `market gate flipped ${lastReading} -> ${to}`
    : `market gate reading ${to} (was ${lastReading}) — no flip`;
  return { flipped, from: lastReading, to, note };
}
