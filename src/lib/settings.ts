// Typed access to per-portfolio risk config (from the Portfolio row) and to
// genuinely global state (the Setting key-value table).

import { prisma } from "@/lib/db";
import { ALLOWED_RANGES, ALLOWED_INTERVALS, type Range, type Interval } from "@/lib/yahoo";

/** The swing scanner's candle timeframe for a portfolio, validated against the
 *  provider's allowed values (falls back to the 1h/3mo swing default). */
export async function getScanTimeframe(portfolioId: number): Promise<{ range: Range; interval: Interval }> {
  const p = await getPortfolio(portfolioId);
  const interval = (ALLOWED_INTERVALS as readonly string[]).includes(p.scanInterval) ? (p.scanInterval as Interval) : "1h";
  const range = (ALLOWED_RANGES as readonly string[]).includes(p.scanRange) ? (p.scanRange as Range) : "3mo";
  return { range, interval };
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Load a portfolio row or throw — the trading core must never fall back to defaults. */
export async function getPortfolio(portfolioId: number) {
  const p = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!p) throw new Error(`portfolio ${portfolioId} not found`);
  return p;
}

export async function isKillSwitchOn(portfolioId: number): Promise<boolean> {
  return (await getPortfolio(portfolioId)).killSwitch;
}

export async function getKillSwitchReason(portfolioId: number): Promise<string> {
  return (await getPortfolio(portfolioId)).killSwitchReason;
}

export async function getMaxOpenPositions(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).maxOpenPositions;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function getStartingBalance(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).startingBalance;
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

export async function getRiskPctPerTrade(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).riskPctPerTrade;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function getDrawdownHaltPct(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).drawdownHaltPct;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Manual global emergency brake — blocks new entries across every portfolio. */
export async function isGlobalTradingHalt(): Promise<boolean> {
  return (await getSetting("globalTradingHalt", "false")) === "true";
}

export interface FearGreed { value: number; label: string; fetchedAt: string }

export async function getFearGreed(): Promise<FearGreed | null> {
  try {
    return JSON.parse(await getSetting("fearGreed", "null")) as FearGreed | null;
  } catch {
    return null;
  }
}
