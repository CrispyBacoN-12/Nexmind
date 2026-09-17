// Overnight financing and the weekend gap — the two costs a bar-close backtest
// cannot see, and which decide whether a small intraday edge survives.
//
// Both are pure calendar arithmetic over UTC epoch milliseconds. Nothing here
// touches the backtest engine: a fold is simulated first, then each trade's
// entry/exit times are handed to these functions and the result is applied as an
// R adjustment. That keeps `CostModel` — which every stocks number in the
// project is quoted against — untouched.
//
// Pre-registered in docs/quant/2026-09-08-xauusd-preregistration.md §4 and §7.

/** MT5 SYMBOL_SWAP_MODE values. Named because the integer alone is unreadable. */
export const SWAP_MODE_DISABLED = 0;
export const SWAP_MODE_POINTS = 1;
export const SWAP_MODE_CURRENCY_SYMBOL = 2;
export const SWAP_MODE_CURRENCY_MARGIN = 3;
export const SWAP_MODE_CURRENCY_DEPOSIT = 4;
export const SWAP_MODE_INTEREST_CURRENT = 5;
export const SWAP_MODE_INTEREST_OPEN = 6;

/**
 * The hour of the broker's own midnight, expressed in UTC. Most MT5 servers run
 * GMT+2/+3, putting rollover at 21:00 or 22:00 UTC depending on the season.
 *
 * It is a parameter with a stated default rather than a modelled DST rule
 * because the shift is the *broker's* choice of server timezone, not a
 * derivable fact — and being wrong by an hour moves a rollover across a day
 * boundary only for positions opened or closed inside that hour. Measure the
 * server's actual rollover before quoting a final number; until then this is
 * the declared assumption.
 */
export const DEFAULT_ROLLOVER_HOUR_UTC = 21;

/** MT5's default triple-swap weekday: Wednesday's rollover carries the weekend. */
export const DEFAULT_TRIPLE_SWAP_DAY = 3;

const MS_PER_DAY = 86_400_000;

/**
 * Guard against a caller handing in a closedAt from a corrupt row. Ten years of
 * nights is far past any holding period this project simulates, and looping to
 * the heat death of the universe on bad data is not a failure mode worth having.
 */
const MAX_ROLLOVERS = 4_000;

export interface RolloverOptions {
  /** Broker midnight in UTC. See DEFAULT_ROLLOVER_HOUR_UTC. */
  rolloverHourUtc?: number;
  /** 0=Sun … 6=Sat. The day whose rollover is charged three times. */
  tripleSwapDay?: number;
}

/**
 * How many nights of financing a position pays, counting the triple day.
 *
 * Charges land at broker midnight on **Monday through Friday only** — the market
 * is shut on Saturday and Sunday nights, which is the entire reason the triple
 * day exists. So a position held a full week pays 1+1+3+1+1 = 7, matching the
 * seven calendar nights it was actually open. A scheme that charged all seven
 * weekdays and also tripled Wednesday would bill nine nights for a seven-night
 * week.
 *
 * A rollover exactly at the open instant is NOT charged; one exactly at the
 * close instant is. The convention has to be picked one way, and this is the
 * conservative one for an entry (the position did not yet exist when the charge
 * was struck).
 */
export function rolloverNights(
  openedAt: number,
  closedAt: number,
  opts: RolloverOptions = {},
): number {
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt)) return 0;
  if (closedAt <= openedAt) return 0;

  const hour = opts.rolloverHourUtc ?? DEFAULT_ROLLOVER_HOUR_UTC;
  const tripleDay = opts.tripleSwapDay ?? DEFAULT_TRIPLE_SWAP_DAY;

  // First rollover instant on or after the open's own calendar day.
  const first = new Date(openedAt);
  first.setUTCHours(hour, 0, 0, 0);

  let nights = 0;
  let charges = 0;
  for (let t = first.getTime(); t <= closedAt; t += MS_PER_DAY) {
    if (t <= openedAt) continue;
    if (++charges > MAX_ROLLOVERS) {
      throw new Error(
        `rolloverNights: more than ${MAX_ROLLOVERS} rollovers between ${new Date(openedAt).toISOString()} and ${new Date(closedAt).toISOString()} — the timestamps are wrong, not the position`,
      );
    }
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue; // market shut; the triple day covers it
    nights += day === tripleDay ? 3 : 1;
  }
  return nights;
}

export interface SwapTerms {
  /** symbol_info.swap_long — per lot, per night, in the unit swapMode names. Signed. */
  swapLong: number;
  /** symbol_info.swap_short. Signed: negative is a charge, positive is a credit. */
  swapShort: number;
  /** symbol_info.swap_mode. */
  swapMode: number;
  /**
   * Account-currency value of one point for one lot — contractSize × point.
   * Required by SWAP_MODE_POINTS, which is what gold usually reports.
   *
   * Deliberately not derived from symbol_info.trade_tick_value: that field was
   * measured wrong by 10× on MetaQuotes-Demo (XAUUSD reported 0.1 where the
   * sibling XAU pairs implied 1.0), so the caller supplies a number it has
   * cross-checked rather than this file trusting a field.
   */
  pointValuePerLot?: number;
  /** Position notional per lot in account currency — required by the interest modes. */
  notionalPerLot?: number;
}

/**
 * Either the charge is known in account currency, or it is not and says why.
 *
 * Modelled as a union so an unpriceable swap mode cannot silently become zero.
 * A gold strategy that clears the gate because financing was quietly treated as
 * free is the exact failure this whole file exists to prevent.
 */
export type SwapCharge =
  | { priced: true; usd: number; nights: number }
  | { priced: false; usd: null; nights: number; reason: string };

/**
 * What `nights` of financing cost, in account currency. Negative is a cost.
 *
 * Only the modes gold is actually quoted in are priced. Everything else refuses
 * rather than guessing at a currency conversion this module has no rate for.
 */
export function swapCost(
  side: "long" | "short",
  lots: number,
  nights: number,
  terms: SwapTerms,
): SwapCharge {
  if (nights <= 0) return { priced: true, usd: 0, nights: 0 };
  if (terms.swapMode === SWAP_MODE_DISABLED) return { priced: true, usd: 0, nights };

  const rate = side === "long" ? terms.swapLong : terms.swapShort;
  const per = lots * nights;

  switch (terms.swapMode) {
    case SWAP_MODE_POINTS: {
      if (terms.pointValuePerLot == null) {
        return { priced: false, usd: null, nights, reason: "swap is quoted in points but pointValuePerLot was not supplied" };
      }
      return { priced: true, usd: rate * terms.pointValuePerLot * per, nights };
    }
    case SWAP_MODE_CURRENCY_DEPOSIT:
      // Already in the deposit (account) currency — nothing to convert.
      return { priced: true, usd: rate * per, nights };

    case SWAP_MODE_INTEREST_CURRENT:
    case SWAP_MODE_INTEREST_OPEN: {
      if (terms.notionalPerLot == null) {
        return { priced: false, usd: null, nights, reason: "swap is an annual interest rate but notionalPerLot was not supplied" };
      }
      // Annual percentage on the position's value, on a 360-day year — the
      // convention MT5 uses for these modes.
      return { priced: true, usd: (rate / 100) * terms.notionalPerLot * lots * (nights / 360), nights };
    }
    default:
      return {
        priced: false,
        usd: null,
        nights,
        reason: `swap_mode ${terms.swapMode} needs a currency conversion this module has no rate for`,
      };
  }
}

/**
 * The financing charge restated in R, so it can be subtracted from a trade's
 * rMultiple directly.
 *
 * Returns null when the charge is unpriced, or when the trade has no measurable
 * risk — the same shape `rMultipleOf` already returns for a trade that cannot be
 * expressed in R, and which every consumer already filters.
 */
export function swapInR(charge: SwapCharge, riskUsd: number): number | null {
  if (!charge.priced) return null;
  if (!Number.isFinite(riskUsd) || riskUsd <= 0) return null;
  return charge.usd / riskUsd;
}

// --- the weekend gap --------------------------------------------------------

/** Friday, in UTC hours. Gold's week ends at broker close on Friday evening. */
export const WEEK_CLOSE_DAY = 5;
/** Sunday. */
export const WEEK_OPEN_DAY = 0;
/** Same season caveat as DEFAULT_ROLLOVER_HOUR_UTC — a stated assumption, not a derived fact. */
export const DEFAULT_WEEK_CLOSE_HOUR_UTC = 21;
export const DEFAULT_WEEK_OPEN_HOUR_UTC = 22;

/**
 * The instant the week closes, at or after `ts`.
 *
 * Used two ways: to decide the last bar a pre-registered "flat before the
 * weekend" rule may hold, and to detect the audit variant that held through.
 */
export function nextWeekClose(ts: number, closeHourUtc = DEFAULT_WEEK_CLOSE_HOUR_UTC): number {
  const d = new Date(ts);
  d.setUTCHours(closeHourUtc, 0, 0, 0);
  const daysAhead = (WEEK_CLOSE_DAY - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  if (d.getTime() < ts) d.setUTCDate(d.getUTCDate() + 7);
  return d.getTime();
}

/**
 * Did this position sit through a weekend close?
 *
 * The pre-registration holds a trade flat before the weekend and reports the
 * hold-through version as an audit row only: an ATR stop cannot be filled across
 * a 49-hour gap, so a backtest that holds through is quoting a stop price that
 * was never available.
 */
export function crossesWeekend(
  openedAt: number,
  closedAt: number,
  closeHourUtc = DEFAULT_WEEK_CLOSE_HOUR_UTC,
): boolean {
  if (closedAt <= openedAt) return false;
  return nextWeekClose(openedAt, closeHourUtc) <= closedAt;
}
