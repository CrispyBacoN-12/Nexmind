// What happens to the card's risk when the fill is not the card's entry.
//
// The card sizes off one entry price and prints the stop as a PRICE. The owner
// rests that stop at that price. If the order then fills higher — a gap up
// overnight, a market order into a moving tape — the stop does not move with
// it, so every share carries more than the card's slDistance of risk and the
// share count printed above is now too many. Nothing on the card used to say so.
//
// Two answers, both reported and neither applied to the card's own size:
//   * the walk-away price: the highest fill at which the card's share count
//     still fits BOTH caps it was sized under. Needs no quote, so it holds at
//     19:00 ICT with the market shut.
//   * the live quote, when one is fresh: the risk the planned shares would
//     carry if bought right now, and the size that would be right at that price.
//
// Pure. The quote and the clock arrive as arguments.

import { sizeShares } from "./sizing";
import type { LiveQuote, ShareSizingResult, SizingCap } from "./types";

/** A quote older than this is not "the price now" and is not used. Same bar
 *  the day-trader-skill risk check uses; at US session pace 15 minutes is
 *  already enough for a fast name to move a stop's width. */
export const QUOTE_MAX_AGE_MIN = 15;

export interface FillGuardInput {
  entry: number;
  stop: number;
  sizing: ShareSizingResult;
  capital: number;
  maxSlots: number;
  riskPct: number;
  quote: LiveQuote | null;
  /** Epoch seconds. Only used to age the quote. */
  nowSec: number | null;
}

export interface FillGuard {
  /** Highest fill keeping the card's shares inside both caps. null when shares is 0. */
  walkAwayPrice: number | null;
  /** Which cap the walk-away price comes from. */
  walkAwayBoundBy: SizingCap | null;
  quote: {
    price: number;
    at: number;
    ageMin: number;
    fresh: boolean;
  } | null;
  /** Always set: what the quote said, or why it was not used. */
  quoteNote: string;
  /** Set only for a fresh quote ABOVE the entry: what buying now does. */
  atQuote: {
    price: number;
    /** card shares * (quote - stop) */
    plannedRiskUsd: number;
    plannedRiskPct: number;
    /** plannedShares * quote */
    plannedCostUsd: number;
    /** Sized again at the quote, against the SAME stop price. */
    resized: ShareSizingResult;
    overWalkAway: boolean;
  } | null;
  /** A fresh quote at or below the stop: the plan is already stopped out. */
  belowStop: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function fillGuard(input: FillGuardInput): FillGuard {
  const { entry, stop, sizing, capital, maxSlots, riskPct, quote, nowSec } = input;
  const shares = sizing.shares;

  let walkAwayPrice: number | null = null;
  let walkAwayBoundBy: SizingCap | null = null;
  if (shares > 0) {
    const byRisk = stop + sizing.riskUsdTarget / shares;
    const byAfford = sizing.slotBudget / shares;
    walkAwayBoundBy = byRisk <= byAfford ? "risk" : "affordability";
    walkAwayPrice = Math.min(byRisk, byAfford);
  }

  const base = { walkAwayPrice, walkAwayBoundBy };

  if (!quote || quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0 || quote.at == null) {
    return {
      ...base,
      quote: null,
      quoteNote: quote?.note ? `No live quote: ${quote.note}.` : "No live quote was fetched.",
      atQuote: null,
      belowStop: false,
    };
  }

  const ageMin = nowSec != null ? Math.max(0, (nowSec - quote.at) / 60) : Infinity;
  const fresh = ageMin <= QUOTE_MAX_AGE_MIN;
  const q = { price: quote.price, at: quote.at, ageMin, fresh };

  if (!fresh) {
    return {
      ...base,
      quote: q,
      quoteNote:
        `The last quote (${money(quote.price)}) is ${Number.isFinite(ageMin) ? `${Math.round(ageMin)} min` : "of unknown age"} old — ` +
        `older than ${QUOTE_MAX_AGE_MIN} min, so it is not treated as the price now (market closed or the feed is behind). ` +
        `The walk-away price still applies.`,
      atQuote: null,
      belowStop: false,
    };
  }

  if (quote.price <= stop) {
    return {
      ...base,
      quote: q,
      quoteNote: `The live quote ${money(quote.price)} is at or below the stop ${money(stop)}. This plan is stopped out before it is entered.`,
      atQuote: null,
      belowStop: true,
    };
  }

  if (quote.price <= entry) {
    return {
      ...base,
      quote: q,
      quoteNote:
        `The live quote ${money(quote.price)} is at or below the entry ${money(entry)}, so buying now risks no more ` +
        `than the card says.`,
      atQuote: null,
      belowStop: false,
    };
  }

  const plannedRiskUsd = shares * (quote.price - stop);
  const resized = sizeShares({ entry: quote.price, slDistance: quote.price - stop, capital, maxSlots, riskPct });
  const overWalkAway = walkAwayPrice != null && quote.price > walkAwayPrice;
  return {
    ...base,
    quote: q,
    quoteNote: overWalkAway
      ? `The live quote ${money(quote.price)} is above the walk-away price ${money(walkAwayPrice as number)}. ` +
        `${shares} share(s) bought now would risk ${money(plannedRiskUsd)} against the stop at ${money(stop)}; ` +
        `at this price the size is ${resized.shares}.`
      : `The live quote ${money(quote.price)} is above the entry but inside the walk-away price, so ${shares} share(s) ` +
        `still fit: ${money(plannedRiskUsd)} at risk against the stop at ${money(stop)}.`,
    atQuote: {
      price: quote.price,
      plannedRiskUsd,
      plannedRiskPct: capital > 0 ? (plannedRiskUsd / capital) * 100 : 0,
      plannedCostUsd: shares * quote.price,
      resized,
      overWalkAway,
    },
    belowStop: false,
  };
}
