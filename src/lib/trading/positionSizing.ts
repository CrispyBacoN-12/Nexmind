// Risk-based lot sizing: targets a roughly constant dollar risk per trade
// (riskUsd / SL distance), then shrinks (never grows) the result when the
// new symbol is highly correlated with currently-open positions.
// Pure — no I/O.

export interface SizingInput {
  entry: number;
  sl: number;
  riskUsd: number; // startingBalance * riskPctPerTrade / 100
  maxLotPerTrade: number;
  minLot?: number; // default 0.01
  avgCorrelation: number | null; // null = no open positions, or no usable price data
}

export interface SizingResult {
  lot: number;
  riskUsd: number;
  slDistance: number;
  corrMultiplier: number;
  avgCorrelation: number | null;
  reasoning: string;
}

function corrMultiplierFor(avgCorrelation: number | null): number {
  if (avgCorrelation == null) return 1;
  if (avgCorrelation >= 0.8) return 0.7;
  if (avgCorrelation >= 0.6) return 0.85;
  return 1;
}

export function computeLot(input: SizingInput): SizingResult {
  const { entry, sl, riskUsd, maxLotPerTrade, avgCorrelation } = input;
  const minLot = input.minLot ?? 0.01;
  const slDistance = Math.abs(entry - sl);

  if (slDistance <= 0) {
    return {
      lot: minLot,
      riskUsd,
      slDistance,
      corrMultiplier: 1,
      avgCorrelation,
      reasoning: `SL distance is zero — falling back to min lot ${minLot}`,
    };
  }

  const riskLot = riskUsd / slDistance;
  const corrMultiplier = corrMultiplierFor(avgCorrelation);
  const afterCorr = riskLot * corrMultiplier;
  const lot = Math.round(Math.min(Math.max(afterCorr, minLot), maxLotPerTrade) * 100) / 100;

  const corrNote =
    avgCorrelation != null
      ? ` · corr ${avgCorrelation.toFixed(2)} (×${corrMultiplier}) → ${lot} lot`
      : "";
  const reasoning = `risk $${riskUsd.toFixed(2)} / SL dist ${slDistance.toFixed(2)} = ${riskLot.toFixed(2)} lot${corrNote}`;

  return { lot, riskUsd, slDistance, corrMultiplier, avgCorrelation, reasoning };
}
