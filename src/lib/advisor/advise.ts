// advise(): everything the card shows, from candle arrays already in hand.
//
// Pure by design — no fetch, no prisma, no clock. The route does the I/O and
// hands the arrays in, so every number here is reproducible from its inputs and
// testable without a network.
//
// Three failure levels, and they are deliberately different:
//   * the asked-about ticker is unusable  -> no card at all, explicit error
//   * a holding is unfetchable            -> card renders; that line reads
//                                            "unknown" and still eats a slot
//   * the benchmark is unfetchable        -> card renders; the gate reads BLIND
//                                            and says so, because the gate must
//                                            never reduce slots silently

import { atr } from "@/lib/indicators";
import { gateSlots, type GateDecision } from "@/lib/market/marketGate";
import { dailyReturns, pearsonCorrelation } from "@/lib/trading/correlation";
import { corrMultiplierFor } from "@/lib/trading/positionSizing";

import { baseRate, BASE_RATE_HORIZON } from "./baseRate";
import { findChartStop, type ChartStopResult, type StopStructure } from "./chartStop";
import { fillGuard } from "./fillGuard";
import { gapRisk } from "./gapRisk";
import { rLadder, costInR } from "./rLadder";
import { sizeShares } from "./sizing";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  ADVISOR_NO_EDGE_CLAIM,
  ADVISOR_R_STEPS,
  type AdvisorCard,
  type AdvisorInput,
  type AdvisorResult,
  type CorrelationLine,
} from "./types";

/** A stop closer than this many ATRs is flagged tight; farther than the wide one, wide. Flags only: the stop never moves. */
const TIGHT_STOP_ATR = 0.5;
const WIDE_STOP_ATR = 3;
const TIGHT_STOP_FLAG = "แคบมาก โดน noise ง่าย";
const WIDE_STOP_FLAG = "กว้างมาก หุ้นที่ซื้อได้จะน้อย";

/** Candle.t is epoch SECONDS, not milliseconds. */
function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export function advise(input: AdvisorInput): AdvisorResult {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "No ticker was given." };

  const candles = input.candles;
  if (!candles || candles.length === 0) {
    return { ok: false, error: `No price history came back for ${ticker}.` };
  }

  const lastBar = candles[candles.length - 1];
  const lastClose = lastBar.c;
  const asOf = barDate(lastBar.t);

  const atrSeries = atr(candles, ADVISOR_ATR_PERIOD);
  const atrValue = atrSeries.at(-1) ?? null;
  if (atrValue == null || !Number.isFinite(atrValue) || atrValue <= 0) {
    return {
      ok: false,
      error:
        `ATR(${ADVISOR_ATR_PERIOD}) could not be computed for ${ticker} from ${candles.length} bars, ` +
        `so there is no stop distance and therefore no size. Nothing is shown rather than a guess.`,
    };
  }

  // Seeded from the caller's own input handling (deduped holdings, dropped
  // tokens). The core never invents these, and they lead the list because they
  // describe what the owner typed rather than what the data did.
  const warnings: string[] = [...(input.inputNotes ?? [])];

  const override = input.entryOverride;
  const useOverride = override != null && Number.isFinite(override) && override > 0;
  const entry = useOverride ? (override as number) : lastClose;
  const entrySource: AdvisorCard["entrySource"] = useOverride ? "override" : "last close";

  // The stop chain: given -> 5-minute swing low -> previous-day low -> 1.5 x ATR.
  // A given stop is judged against the FINAL entry (override or last close). One
  // that is not strictly below it would give a zero or negative distance and so
  // no size, or a short's geometry on a long-only card — it is skipped, loudly,
  // and the chain goes on to the chart.
  const stopGiven = input.stopOverride;
  const useGivenStop =
    stopGiven != null && Number.isFinite(stopGiven) && stopGiven > 0 && stopGiven < entry;
  if (stopGiven != null && !useGivenStop) {
    warnings.push(`Stop ที่ให้มา (${stopGiven}) ไม่ได้อยู่ใต้ราคาเข้า จึงหา stop จากกราฟแทน`);
  }

  let stopSource: AdvisorCard["stopSource"] = "atr";
  let stop = entry - ADVISOR_ATR_SL_MULT * atrValue;
  let stopStructure: StopStructure | null = null;
  const stopNotes: string[] = [];
  if (useGivenStop) {
    stopSource = "given";
    stop = stopGiven as number;
  } else {
    // Absent or null intraday: no 5-minute read was attempted, so no note.
    const intraday = input.intraday;
    let chart: ChartStopResult | null = null;
    if (intraday && "error" in intraday) {
      stopNotes.push(`ดึงกราฟ 5 นาทีไม่ได้: ${intraday.error}`);
    } else if (intraday) {
      chart = findChartStop({ candles: intraday.candles, entry, atr: atrValue, cutoffSec: intraday.cutoffSec });
      stopNotes.push(...(chart.kind === "found" ? chart.skipped : chart.reasons));
      if (chart.kind === "found" && chart.adjusted) stopNotes.push(chart.adjusted);
    }
    if (chart?.kind === "found") {
      stopSource = chart.source;
      stop = chart.stop;
      stopStructure = chart.structure;
    } else if (stopNotes.length > 0) {
      stopNotes.push(`จึงใช้ ${ADVISOR_ATR_SL_MULT}×ATR`);
    }
  }
  const slDistance = entry - stop;
  // Exactly the constant for an ATR stop (not slDistance / atr, which can drift
  // in the last bit); any other stop's multiple is whatever it works out to.
  const stopAtrMult = stopSource === "atr" ? ADVISOR_ATR_SL_MULT : slDistance / atrValue;

  // Reported, never applied: a structural stop that is very tight or very wide
  // is the owner's call, and the plain ATR stop is shown beside it to compare.
  const stopFlags: string[] = [];
  if (stopSource !== "atr") {
    if (slDistance < TIGHT_STOP_ATR * atrValue) stopFlags.push(TIGHT_STOP_FLAG);
    if (slDistance > WIDE_STOP_ATR * atrValue) stopFlags.push(WIDE_STOP_FLAG);
  }

  const sizing = sizeShares({
    entry,
    slDistance,
    capital: input.capital,
    maxSlots: input.maxSlots,
    riskPct: input.riskPct,
  });
  const atrAlternative =
    stopSource === "atr"
      ? null
      : {
          stop: entry - ADVISOR_ATR_SL_MULT * atrValue,
          atrMult: ADVISOR_ATR_SL_MULT,
          shares: sizeShares({
            entry,
            slDistance: ADVISOR_ATR_SL_MULT * atrValue,
            capital: input.capital,
            maxSlots: input.maxSlots,
            riskPct: input.riskPct,
          }).shares,
        };

  const costBps = input.costBps ?? ADVISOR_COST_BPS;
  const ladder = rLadder(entry, slDistance, sizing.shares);
  const costR = costInR(entry, slDistance, costBps);

  // Correlation against what is already held. Reported, never applied.
  //
  // pearsonCorrelation zips the two return series by TRAILING INDEX, not by
  // date — its own comment says so — and the fetch layer will happily return a
  // holding whose last bar is several sessions older than this ticker's. That
  // pairs Tuesday's return with Thursday's and still yields a number, so a
  // series that does not end on the same date is labelled approximate rather
  // than rendered as a clean reading.
  const tickerReturns = dailyReturns(candles);
  const correlations: CorrelationLine[] = input.holdings.map((h) => {
    const name = h.ticker.trim().toUpperCase();
    if (!h.candles || h.candles.length === 0) {
      warnings.push(`${name}: price history could not be fetched, so its correlation is unknown. It still consumes a slot.`);
      return { ticker: name, correlation: null, note: "price history could not be fetched" };
    }
    const c = pearsonCorrelation(tickerReturns, dailyReturns(h.candles));
    if (c == null) {
      return { ticker: name, correlation: null, note: "too few overlapping bars, or no variance" };
    }
    const holdingAsOf = barDate(h.candles[h.candles.length - 1].t);
    if (holdingAsOf !== asOf) {
      warnings.push(
        `${name}: its last bar is ${holdingAsOf} while ${ticker}'s is ${asOf}. The correlation pairs the two ` +
          `series by position rather than by date, so that reading is approximate.`,
      );
      return {
        ticker: name,
        correlation: c,
        note: `approximate: this series ends ${holdingAsOf}, ${ticker} ends ${asOf}`,
      };
    }
    return { ticker: name, correlation: c, note: "" };
  });

  const known = correlations.map((c) => c.correlation).filter((c): c is number => c != null);
  const avgCorrelation = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const corrMultiplier = corrMultiplierFor(avgCorrelation);
  const corrAdjustedShares = Math.floor(sizing.shares * corrMultiplier);

  const freeSlots = Math.max(0, input.maxSlots - input.holdings.length);

  const benchmark = input.benchmark;
  let gate: GateDecision;
  if (benchmark && benchmark.length > 0) {
    gate = gateSlots(benchmark, freeSlots);
  } else {
    gate = {
      slots: freeSlots,
      benchAbove: null,
      shortsAllowed: true,
      note: "BLIND: the benchmark could not be fetched, so the market gate is not reducing slots. It never reduces them silently.",
    };
    warnings.push("The benchmark (SPY) could not be fetched, so the market regime is unknown.");
  }

  // Gap-through risk, from the longer history when the route supplied it. It is
  // disclosed, not applied: the size above still assumes a -1R stop-out, and the
  // owner sees next to it what the sample says a bad open would have cost.
  const gap = gapRisk(input.gapHistory ?? candles, stopAtrMult);
  const gapWorstLossUsd = gap ? sizing.shares * slDistance * gap.worstLossR : null;
  if (!gap) {
    warnings.push(`Too little daily history to read ${ticker}'s overnight gap risk, so the -1R stop-out on this card is unchecked against gaps.`);
  } else if (gap.overOneStop > 0) {
    warnings.push(
      `${ticker} opened a full stop or more below the prior close on ${gap.overOneStop} of ${gap.sessions} sessions ` +
        `(${gap.from} to ${gap.to}). On those nights a stop does not cap the loss at 1R.`,
    );
  }

  // The card is sized at `entry`; this says what a higher fill does to that size.
  const guard = fillGuard({
    entry,
    stop,
    sizing,
    capital: input.capital,
    maxSlots: input.maxSlots,
    riskPct: input.riskPct,
    quote: input.quote ?? null,
    nowSec: input.nowSec ?? null,
  });
  if (guard.belowStop || guard.atQuote?.overWalkAway) warnings.push(guard.quoteNote);

  const alreadyHeld = input.holdings.some((h) => h.ticker.trim().toUpperCase() === ticker);

  const card: AdvisorCard = {
    ticker,
    asOf,
    lastClose,
    entry,
    entrySource,
    atr: atrValue,
    slDistance,
    stop,
    stopSource,
    stopNotes,
    stopFlags,
    stopStructure,
    atrAlternative,
    stopAtrMult,
    sizing,
    deployedUsd: sizing.shares * entry,
    ladder,
    costR,
    correlations,
    avgCorrelation,
    corrMultiplier,
    corrAdjustedShares,
    freeSlots,
    gate,
    // Copied, never derived. advise() has no clock and no network, so it cannot
    // check this date against anything; it carries it to the card so that the
    // card and the facts sheet are looking at the same object.
    earnings: input.earnings ?? null,
    gapRisk: gap,
    gapWorstLossUsd,
    fillGuard: guard,
    // From the 2y history only: the 6mo series leaves too few complete windows,
    // and a base rate off a quarter of data would be a story about that quarter.
    // Replayed at the card's own stop multiple (1.5 for an ATR stop, the chart
    // stop's k otherwise), so the table describes the stop the card sized.
    baseRate: baseRate(input.gapHistory, ADVISOR_R_STEPS, BASE_RATE_HORIZON, stopAtrMult),
    alreadyHeld,
    warnings,
    noEdgeClaim: ADVISOR_NO_EDGE_CLAIM,
  };

  return { ok: true, card };
}
