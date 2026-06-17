import { prisma } from "@/lib/db";
import { settlementValue } from "./optionStats";
import type { OptionType } from "./blackScholes";

const MULT = 100;

export function closePnl(contracts: number, premiumPaid: number, exitPremium: number): number {
  return contracts * MULT * (exitPremium - premiumPaid);
}

export function clampContracts(want: number, cash: number, premium: number): number {
  if (!(premium > 0)) return 0;
  return Math.min(want, Math.floor(cash / (MULT * premium)));
}

export interface BuyOptionInput { underlying: string; type: OptionType; strike: number; expiry: Date; contracts: number; premium: number }

export async function buyOption(portfolioId: number, input: BuyOptionInput): Promise<{ ok: boolean; note: string }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  const contracts = clampContracts(input.contracts, portfolio.cash, input.premium);
  if (!(contracts > 0)) return { ok: false, note: "insufficient cash" };
  const cost = contracts * MULT * input.premium;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.create({
      data: { portfolioId, underlying: input.underlying, type: input.type, strike: input.strike, expiry: input.expiry, contracts, premiumPaid: input.premium },
    });
    await tx.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash - cost } });
  });
  return { ok: true, note: `buy ${contracts} ${input.underlying} ${input.type} ${input.strike} @ ${input.premium.toFixed(2)}` };
}

export async function closeOption(positionId: number, exitPremium: number): Promise<{ ok: boolean; note: string }> {
  const pos = await prisma.optionHolding.findUnique({ where: { id: positionId } });
  if (!pos || pos.status !== "open") return { ok: false, note: "position not open" };
  const proceeds = pos.contracts * MULT * exitPremium;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.update({
      where: { id: positionId },
      data: { status: "closed", closedAt: new Date(), realizedPnl: pos.realizedPnl + closePnl(pos.contracts, pos.premiumPaid, exitPremium) },
    });
    const p = await tx.portfolio.findUnique({ where: { id: pos.portfolioId } });
    await tx.portfolio.update({ where: { id: pos.portfolioId }, data: { cash: (p?.cash ?? 0) + proceeds } });
  });
  return { ok: true, note: `close ${pos.underlying} ${pos.type} ${pos.strike} @ ${exitPremium.toFixed(2)}` };
}

export async function settleOption(positionId: number, underlyingPrice: number): Promise<{ ok: boolean; note: string }> {
  const pos = await prisma.optionHolding.findUnique({ where: { id: positionId } });
  if (!pos || pos.status !== "open") return { ok: false, note: "position not open" };
  const intrinsic = settlementValue(pos.type as OptionType, pos.strike, underlyingPrice);
  const value = pos.contracts * MULT * intrinsic;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.update({
      where: { id: positionId },
      data: { status: "expired", closedAt: new Date(), realizedPnl: pos.realizedPnl + (value - pos.contracts * MULT * pos.premiumPaid) },
    });
    const p = await tx.portfolio.findUnique({ where: { id: pos.portfolioId } });
    await tx.portfolio.update({ where: { id: pos.portfolioId }, data: { cash: (p?.cash ?? 0) + value } });
  });
  return { ok: true, note: `settle ${pos.underlying} ${pos.type} ${pos.strike} → ${intrinsic.toFixed(2)} intrinsic` };
}
