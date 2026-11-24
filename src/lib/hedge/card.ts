// One /journal protective-put card per open journal position. Data sources are
// injected so each one can fail on its own without blanking the card: a missing
// option chain still shows the stop-only loss, a missing live quote falls back
// to the last daily close and says so.
// Spec: docs/superpowers/specs/2026-11-25-journal-put-hedge-design.md

import type { EarningsInfo, LiveQuote } from "@/lib/advisor/types";
import type { Candle } from "@/lib/indicators";

import type { PutQuotesResult, PutWindow } from "./alpacaPuts";
import {
  addDays,
  chooseExpiryTarget,
  contractsFor,
  EXPIRY_WINDOW_DAYS,
  isQuoteStale,
  overHedge,
  pickExpiry,
  pickStrikes,
  rowMath,
  stopOnly,
  STRIKE_CAP_FRAC,
  worstGapDownPct,
} from "./math";
import type { MissingTarget, RowMath, StopOnly, StrikePick } from "./types";

export interface HedgePosition {
  id: number;
  ticker: string;
  shares: number;
  entryPrice: number;
  stop: number;
}

export interface HedgeRow extends StrikePick, RowMath {
  bid: number | null;
  ask: number | null;
  quotedAt: string | null;
  stale: boolean;
}

export interface HedgeCard {
  id: number;
  ticker: string;
  shares: number;
  entryPrice: number;
  stop: number;
  price: number | null;
  priceSource: "live" | "lastClose" | null;
  /** ISO time of the price. */
  priceAt: string | null;
  priceNote: string | null;
  earnings: EarningsInfo;
  expiry: string | null;
  expiryReason: "afterEarnings" | "about30d" | null;
  contracts: number;
  overHedge: number;
  rows: HedgeRow[];
  missing: MissingTarget[];
  stopOnly: StopOnly | null;
  optionsError: string | null;
}

export interface HedgeDeps {
  liveQuote(t: string): Promise<LiveQuote>;
  earnings(t: string): Promise<EarningsInfo>;
  putQuotes(t: string, w: PutWindow): Promise<PutQuotesResult>;
  candles: Candle[] | null;
}

const short = (e: unknown) => String(e).slice(0, 80);

export async function buildHedgeCard(p: HedgePosition, deps: HedgeDeps, todayNY: string, nowMs: number): Promise<HedgeCard> {
  const contracts = contractsFor(p.shares);
  const card: HedgeCard = {
    id: p.id,
    ticker: p.ticker,
    shares: p.shares,
    entryPrice: p.entryPrice,
    stop: p.stop,
    price: null,
    priceSource: null,
    priceAt: null,
    priceNote: null,
    earnings: { date: null, hour: null, note: "not fetched" },
    expiry: null,
    expiryReason: null,
    contracts,
    overHedge: overHedge(p.shares, contracts),
    rows: [],
    missing: [],
    stopOnly: null,
    optionsError: null,
  };

  // Price: live first, then the newest daily close (forming or not).
  let live: LiveQuote;
  try {
    live = await deps.liveQuote(p.ticker);
  } catch (e) {
    live = { price: null, at: null, note: short(e) };
  }
  const last = deps.candles?.at(-1);
  if (live.price != null && live.price > 0) {
    card.price = live.price;
    card.priceSource = "live";
    card.priceAt = live.at != null ? new Date(live.at * 1000).toISOString() : null;
  } else if (last && last.c > 0) {
    card.price = last.c;
    card.priceSource = "lastClose";
    card.priceAt = new Date(last.t * 1000).toISOString();
    card.priceNote = `live quote unavailable: ${live.note ?? "no price"}`;
  } else {
    card.priceNote = `no price: ${live.note ?? "no live quote and no daily bars"}`;
  }

  try {
    card.earnings = await deps.earnings(p.ticker);
  } catch (e) {
    card.earnings = { date: null, hour: null, note: `earnings fetch failed: ${short(e)}` };
  }

  const price = card.price;
  if (price == null) return card;

  card.stopOnly = stopOnly({
    entry: p.entryPrice,
    stop: p.stop,
    shares: p.shares,
    price,
    gapPct: worstGapDownPct(deps.candles),
  });

  const target = chooseExpiryTarget(todayNY, card.earnings);
  card.expiryReason = target.reason;
  const low = p.stop < price ? Math.min(p.stop, price * 0.95) : price * 0.95;
  const window: PutWindow = {
    expGte: target.gte,
    expLte: addDays(target.gte, EXPIRY_WINDOW_DAYS),
    strikeGte: Math.max(0, low - STRIKE_CAP_FRAC * price),
    strikeLte: price * (1 + STRIKE_CAP_FRAC),
  };

  let res: PutQuotesResult;
  try {
    res = await deps.putQuotes(p.ticker, window);
  } catch (e) {
    res = { error: `option quotes fetch failed: ${short(e)}` };
  }
  if ("error" in res) {
    card.optionsError = res.error;
    return card;
  }

  card.expiry = pickExpiry(res.quotes, target.gte);
  if (card.expiry == null) return card;

  const atExpiry = res.quotes.filter((q) => q.expiry === card.expiry);
  const { picks, missing } = pickStrikes(atExpiry.map((q) => q.strike), price, p.stop);
  card.missing = missing;
  card.rows = picks.map((pick) => {
    const q = atExpiry.find((x) => x.strike === pick.strike)!;
    return {
      ...pick,
      ...rowMath({ shares: p.shares, entry: p.entryPrice, price, strike: pick.strike, contracts, bid: q.bid, ask: q.ask }),
      bid: q.bid,
      ask: q.ask,
      quotedAt: q.quotedAt,
      stale: isQuoteStale(q.quotedAt, nowMs),
    };
  });
  return card;
}
