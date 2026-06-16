// Pure advisory rebalance planner. Given current holdings (priced), per-symbol
// committee reads, the target position count, drift band, cash, and equity,
// returns an ordered list of proposed BUY/ADD/TRIM/SELL actions. No I/O — the
// executor re-prices at approval time, so estPrice here is advisory.

export type Rating = "strong-buy" | "buy" | "watch" | "hold" | "avoid";
export type ActionKind = "buy" | "add" | "trim" | "sell";

export interface PlannerHolding { symbol: string; shares: number; avgCost: number; price: number }
export interface CommitteeRead { symbol: string; rating: Rating; entryHigh: number | null; price: number }

export interface RebalanceInput {
  holdings: PlannerHolding[];
  reads: CommitteeRead[];
  maxPositions: number;
  bandPct: number;
  cash: number;
  equity: number;
}

export interface RebalanceAction {
  kind: ActionKind;
  symbol: string;
  shares: number;
  estPrice: number;
  reason: string;
}

const BUYABLE: Rating[] = ["strong-buy", "buy"];

export function planRebalance(input: RebalanceInput): RebalanceAction[] {
  const { holdings, reads, maxPositions, bandPct, cash, equity } = input;
  const target = maxPositions > 0 ? equity / maxPositions : 0;
  const band = bandPct / 100;
  const readBySymbol = new Map(reads.map((r) => [r.symbol, r]));

  const sells: RebalanceAction[] = [];
  const trims: RebalanceAction[] = [];
  const buys: RebalanceAction[] = [];
  const adds: RebalanceAction[] = [];

  let availCash = cash;
  const survivingHeld = new Set(holdings.map((h) => h.symbol));

  // SELL — held names the committee downgraded to avoid.
  for (const h of holdings) {
    const r = readBySymbol.get(h.symbol);
    if (r?.rating === "avoid") {
      sells.push({ kind: "sell", symbol: h.symbol, shares: h.shares, estPrice: h.price, reason: "committee downgraded to avoid" });
      availCash += h.shares * h.price;
      survivingHeld.delete(h.symbol);
    }
  }

  // TRIM — overweight holdings (not being sold) above target + band.
  for (const h of holdings) {
    if (!survivingHeld.has(h.symbol)) continue;
    const value = h.shares * h.price;
    if (value > target * (1 + band) && h.price > 0) {
      const trimShares = (value - target) / h.price;
      trims.push({ kind: "trim", symbol: h.symbol, shares: trimShares, estPrice: h.price, reason: `overweight ${(value / equity * 100).toFixed(0)}% > target ${(100 / maxPositions).toFixed(0)}%` });
      availCash += trimShares * h.price;
    }
  }

  // BUY — new in-zone buy/strong-buy names, until at capacity, cash permitting.
  let heldCount = survivingHeld.size;
  const heldSymbols = new Set(holdings.map((h) => h.symbol)); // original holdings — never "buy" a name we already hold/are selling
  const buyRank = (r: Rating) => (r === "strong-buy" ? 0 : 1); // strong-buy before buy
  const buyCandidates = reads
    .filter((r) => !heldSymbols.has(r.symbol) && BUYABLE.includes(r.rating))
    .filter((r) => r.entryHigh == null || r.price <= r.entryHigh)
    .sort((a, b) => buyRank(a.rating) - buyRank(b.rating));
  for (const r of buyCandidates) {
    if (heldCount >= maxPositions) break;
    if (r.price <= 0) continue;
    const spend = Math.min(target, availCash);
    if (spend <= 0) break;
    const shares = spend / r.price;
    if (shares <= 0) continue;
    buys.push({ kind: "buy", symbol: r.symbol, shares, estPrice: r.price, reason: `${r.rating} in accumulation zone` });
    availCash -= shares * r.price;
    heldCount += 1;
  }

  // ADD — underweight holdings (not avoid, not being sold) below target − band.
  for (const h of holdings) {
    if (!survivingHeld.has(h.symbol)) continue;
    const r = readBySymbol.get(h.symbol);
    if (r?.rating === "avoid") continue;
    const value = h.shares * h.price;
    if (value < target * (1 - band) && h.price > 0) {
      const want = target - value;
      const spend = Math.min(want, availCash);
      if (spend <= 0) continue;
      const shares = spend / h.price;
      if (shares <= 0) continue;
      adds.push({ kind: "add", symbol: h.symbol, shares, estPrice: h.price, reason: `underweight — top up toward target` });
      availCash -= shares * h.price;
    }
  }

  return [...sells, ...trims, ...buys, ...adds];
}
