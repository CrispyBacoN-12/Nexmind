// Autonomous options desk — settle expired (always), close flipped/near-expiry,
// open new calls/puts by target delta. Mirrors the swing desk's autonomous shape.

import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt } from "@/lib/settings";
import { fetchCandles } from "@/lib/marketData";
import type { CandleResponse } from "@/lib/yahoo";
import { getWatchlist } from "@/lib/trading/watchlist";
import { analyzeLongTerm, type InvestResult } from "@/lib/invest/analyze";
import { fetchOptionChain, type OptionQuote } from "./chain";
import { chooseExpiry, chooseStrike, directionToType, sizeContracts, type Rating } from "./select";
import { computeOptionStats, type OptionPosition } from "./optionStats";
import { buyOption, closeOption, settleOption } from "./execute";
import { RISK_FREE_RATE } from "./blackScholes";

const MIN_DAYS_TO_EXPIRY = 30;
const NEAR_EXPIRY_DAYS = 7;
const TARGET_DELTA = 0.5;

export interface OptionsRunSummary {
  settled: string[];
  closed: string[];
  opened: string[];
  errors: string[];
}

async function underlyingPrice(symbol: string): Promise<number | null> {
  try {
    const r: CandleResponse = await fetchCandles(symbol, "1d", "5m");
    return r.price ?? r.candles.at(-1)?.c ?? null;
  } catch { return null; }
}

function mid(q: OptionQuote): number {
  return q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q.lastPrice;
}

export async function runOptions(portfolioId: number): Promise<OptionsRunSummary> {
  const summary: OptionsRunSummary = { settled: [], closed: [], opened: [], errors: [] };
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  if (!isOptionsKind(portfolio.kind)) throw new Error("not an options portfolio");

  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Settle expired (always — mechanical).
  const open = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  for (const pos of open) {
    if (pos.expiry.getTime() <= Date.now()) {
      const px = await underlyingPrice(pos.underlying);
      if (px == null) { summary.errors.push(`settle ${pos.underlying}: no price`); continue; }
      try {
        const r = await settleOption(pos.id, px);
        if (r.ok) summary.settled.push(r.note);
      } catch (e) { summary.errors.push(String(e)); }
    }
  }

  const canTrade = portfolio.status !== "archived" && !portfolio.killSwitch && !(await isGlobalTradingHalt());
  if (!canTrade) return summary;

  const reads = new Map<string, { rating: Rating; price: number }>();
  const readOf = async (sym: string): Promise<{ rating: Rating; price: number } | null> => {
    if (reads.has(sym)) return reads.get(sym)!;
    try {
      const a: InvestResult = await analyzeLongTerm(sym);
      // Verdict.rating is "strong-buy"|"buy"|"watch"|"avoid" — all are valid Rating values.
      const rating = a.verdict.rating as Rating;
      const r = { rating, price: a.price };
      reads.set(sym, r);
      return r;
    } catch (e) { summary.errors.push(`analyze ${sym}: ${e}`); return null; }
  };

  // 2. Close flipped/near-expiry.
  const stillOpen = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  for (const pos of stillOpen) {
    const daysLeft = (pos.expiry.getTime() - Date.now()) / 86_400_000;
    const read = await readOf(pos.underlying);
    const flipped = read != null && (
      (pos.type === "call" && read.rating === "avoid") ||
      (pos.type === "put" && (read.rating === "buy" || read.rating === "strong-buy"))
    );
    if (!flipped && daysLeft > NEAR_EXPIRY_DAYS) continue;
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      const premium = q ? mid(q) : 0;
      const r = await closeOption(pos.id, premium);
      if (r.ok) summary.closed.push(`${r.note} (${flipped ? "flip" : "near-expiry"})`);
    } catch (e) { summary.errors.push(`close ${pos.underlying}: ${e}`); }
  }

  // 3. Open new positions.
  const held = new Set(
    (await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" }, select: { underlying: true } }))
      .map((h) => h.underlying),
  );
  let heldCount = held.size;

  const watchlistItems = await getWatchlist(portfolioId);
  const watch = watchlistItems
    .filter((w) => w.enabled !== false)
    .map((w) => w.symbol);

  // Compute equity for per-position budget.
  const openForStats = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  const premiumCache = new Map<number, number | null>();
  for (const pos of openForStats) {
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      premiumCache.set(pos.id, q ? mid(q) : null);
    } catch { premiumCache.set(pos.id, null); }
  }
  const freshPortfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  const positionsForStats: OptionPosition[] = openForStats.map((p) => ({
    id: p.id,
    underlying: p.underlying,
    type: p.type as "call" | "put",
    strike: p.strike,
    status: p.status,
    contracts: p.contracts,
    premiumPaid: p.premiumPaid,
    realizedPnl: p.realizedPnl,
  }));
  const stats = computeOptionStats(
    positionsForStats,
    (p) => premiumCache.get(p.id) ?? null,
    freshPortfolio?.cash ?? 0,
  );
  const budget = portfolio.maxOpenPositions > 0 ? stats.equity / portfolio.maxOpenPositions : 0;

  for (const sym of watch) {
    if (heldCount >= portfolio.maxOpenPositions) break;
    if (held.has(sym)) continue;
    const read = await readOf(sym);
    if (!read) continue;
    const type = directionToType(read.rating);
    if (!type) continue;
    try {
      const base = await fetchOptionChain(sym);
      const expiry = chooseExpiry(base.expiries, nowSec, MIN_DAYS_TO_EXPIRY);
      if (expiry == null) { summary.errors.push(`open ${sym}: no expiry ≥ ${MIN_DAYS_TO_EXPIRY}d`); continue; }
      const chain = await fetchOptionChain(sym, expiry);
      const quotes = type === "call" ? chain.calls : chain.puts;
      const q = chooseStrike(quotes, chain.underlyingPrice, type, TARGET_DELTA, RISK_FREE_RATE, nowSec);
      if (!q) { summary.errors.push(`open ${sym}: no strike`); continue; }
      const premium = mid(q);
      const contracts = sizeContracts(budget, premium);
      if (contracts <= 0) { summary.errors.push(`open ${sym}: budget too small`); continue; }
      const r = await buyOption(portfolioId, {
        underlying: sym,
        type,
        strike: q.strike,
        expiry: new Date(q.expiry * 1000),
        contracts,
        premium,
      });
      if (r.ok) { summary.opened.push(r.note); heldCount += 1; }
    } catch (e) { summary.errors.push(`open ${sym}: ${e}`); }
  }

  return summary;
}
