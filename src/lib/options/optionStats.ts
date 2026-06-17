import type { OptionType } from "./blackScholes";

export interface OptionPosition {
  id: number;
  underlying: string;
  type: OptionType;
  strike: number;
  status: string;
  contracts: number;
  premiumPaid: number;
  realizedPnl: number;
}

export interface OptionStats {
  cash: number;
  marketValue: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  missingPremiums: string[];
}

const MULT = 100;

export function settlementValue(type: OptionType, strike: number, underlyingPrice: number): number {
  return type === "call" ? Math.max(0, underlyingPrice - strike) : Math.max(0, strike - underlyingPrice);
}

export function computeOptionStats(
  positions: OptionPosition[],
  premiumOf: (p: OptionPosition) => number | null,
  cash: number,
): OptionStats {
  const open = positions.filter((p) => p.status === "open");
  const missingPremiums: string[] = [];
  let marketValue = 0;
  let cost = 0;
  for (const p of open) {
    const px = premiumOf(p);
    if (px == null) missingPremiums.push(`${p.underlying} ${p.type} ${p.strike}`);
    const prem = px ?? p.premiumPaid;
    marketValue += p.contracts * MULT * prem;
    cost += p.contracts * MULT * p.premiumPaid;
  }
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  return { cash, marketValue, equity: cash + marketValue, unrealizedPnl: marketValue - cost, realizedPnl, missingPremiums };
}
