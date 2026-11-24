// Shared shapes for the /journal protective-put card.
// Spec: docs/superpowers/specs/2026-11-25-journal-put-hedge-design.md

/** Which reference price a listed strike was picked for. */
export type StrikeTarget = "stop" | "minus5" | "atm";

/** One put contract's indicative quote, as Alpaca's snapshot gives it. */
export interface PutQuote {
  symbol: string;
  /** YYYY-MM-DD, parsed from the contract symbol. */
  expiry: string;
  strike: number;
  bid: number | null;
  ask: number | null;
  /** ISO timestamp of the quote, or null when the snapshot carried none. */
  quotedAt: string | null;
}

export interface StrikePick {
  strike: number;
  targets: StrikeTarget[];
}

export interface MissingTarget {
  target: StrikeTarget;
  reason: "priceBelowStop" | "noStrikeNear";
}

export interface RowMath {
  premiumTotal: number | null;
  /** premiumTotal / (price × shares), a fraction (0.022 = 2.2%). */
  premiumPct: number | null;
  breakeven: number | null;
  maxLossWithPut: number | null;
  /** (price − strike) / price, a fraction; negative when the strike is above the price. */
  distancePct: number;
  wideSpread: boolean;
}

export interface StopOnly {
  /** Loss if the stop fills exactly at the stop. */
  atStop: number | null;
  /** The ticker's worst overnight gap-down of the last year, a fraction. */
  gapPct: number | null;
  /** Loss if the stock opened that much below the current price. */
  gapLoss: number | null;
  note: "stopNotBelowEntry" | "notEnoughHistory" | null;
}
