// The advisory tool's only I/O. Everything in src/lib/advisor/ is pure and
// takes candle arrays; this route is what fetches them.
//
// The benchmark is fetched on its own rather than folded into the batch: SMA200
// needs 200 sessions (~290 calendar days), fetchCandlesBatch takes no minDays,
// and a "6mo" SPY would make the gate read BLIND on every request with nobody
// the wiser.

import { advise } from "@/lib/advisor/advise";
import { chartSeries, CHART_MIN_SESSIONS } from "@/lib/advisor/chartSeries";
import type { HoldingInput } from "@/lib/advisor/types";
import { fetchNextEarnings } from "@/lib/market/earnings";
import { fetchLiveQuote } from "@/lib/market/quote";
import { BENCHMARK } from "@/lib/market/regime";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import type { CandleResponse } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_HOLDINGS = 20;

/** No /g flag, so .test() is stateless and this is safe to share. */
const TICKER_RE = /^[A-Z][A-Z.\-]{0,9}$/;

/** A percentage of capital above 100 is not a risk percentage. Capital and
 *  slot count have no natural ceiling here, so neither gets one. */
const MAX_RISK_PCT = 100;

/** US sessions in a calendar year. The conversion below needs it. */
const SESSIONS_PER_YEAR = 252;

/**
 * Calendar-day floor for the chart's own history pull.
 *
 * `fetchCandles`'s minDays is CALENDAR days — it is `coversDays`, the span from
 * first bar to last — while CHART_MIN_SESSIONS counts SESSIONS. Converting is
 * not optional: 326 sessions asked for as 326 calendar days would accept a
 * series a third too short, and the SMA200 line would then start two thirds of
 * the way across the chart, which reads as missing data rather than as a
 * window. A "2y" daily pull spans ~730 calendar days, so it clears this
 * comfortably; anything that does not is treated as a miss and the chart is
 * dropped rather than drawn half-lined.
 */
const CHART_MIN_CALENDAR_DAYS = Math.floor((CHART_MIN_SESSIONS * 365) / SESSIONS_PER_YEAR);

interface ParsedField {
  /** null when the field was absent or blank — the caller's default applies. */
  value: number | null;
  /** Set when the field was PRESENT but unusable. Nothing else is valid then. */
  error?: string;
}

/**
 * Splits "absent" from "malformed", which is the whole point of it.
 *
 * A blank field is the form's normal blank-means-default behaviour and keeps
 * its default. A field the owner actually typed into that does not parse —
 * "0.5%", "3,000", "18O.00" — is an error, never a silent fallback: falling
 * back would print a risk percentage and a dollar figure that were never
 * asked for, and nothing on the card echoes capital back to give it away.
 */
function readPositive(raw: unknown, label: string, max?: number): ParsedField {
  if (raw == null) return { value: null };
  if (typeof raw === "string" && raw.trim() === "") return { value: null };

  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, error: `${label} must be a positive number — got "${String(raw)}".` };
  }
  if (max != null && n > max) {
    return { value: null, error: `${label} must be a positive number no greater than ${max} — got "${String(raw)}".` };
  }
  return { value: n };
}

/**
 * Holdings as typed, deduped case-insensitively in first-seen order. Every
 * token that does not survive produces a note: a dropped or collapsed name
 * changes freeSlots, and a slot count that moved for an unstated reason is the
 * silent failure this tool is not allowed to have.
 */
function readHoldings(raw: unknown): { tickers: string[]; notes: string[] } {
  const notes: string[] = [];
  if (!Array.isArray(raw)) return { tickers: [], notes };

  const tickers: string[] = [];
  const seen = new Set<string>();
  const rejected: string[] = [];
  const duplicates: string[] = [];
  let truncated = 0;

  for (const h of raw) {
    const t = String(h ?? "").trim().toUpperCase();
    if (t === "") continue;
    if (!TICKER_RE.test(t)) {
      rejected.push(t);
      continue;
    }
    if (seen.has(t)) {
      duplicates.push(t);
      continue;
    }
    if (tickers.length >= MAX_HOLDINGS) {
      truncated++;
      continue;
    }
    seen.add(t);
    tickers.push(t);
  }

  if (rejected.length > 0) {
    notes.push(
      `Ignored ${rejected.length} holding(s) that are not ticker symbols: ${rejected.map((r) => `"${r}"`).join(", ")}. ` +
        `They do not consume a slot.`,
    );
  }
  if (duplicates.length > 0) {
    notes.push(
      `Collapsed ${duplicates.length} duplicate holding entry(s) (${Array.from(new Set(duplicates)).join(", ")}). ` +
        `Each name counts once, so the free-slot count is higher than the list you typed.`,
    );
  }
  if (truncated > 0) {
    notes.push(
      `Only the first ${MAX_HOLDINGS} holdings were used; ${truncated} more were ignored and do not consume a slot.`,
    );
  }

  return { tickers, notes };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return Response.json({ ok: false, error: "Enter a ticker symbol, e.g. AAPL." }, { status: 400 });
  }

  const fields = {
    capital: readPositive(body.capital, "Capital"),
    maxSlots: readPositive(body.maxSlots, "Max slots"),
    riskPct: readPositive(body.riskPct, "Risk per trade", MAX_RISK_PCT),
    entry: readPositive(body.entry, "Entry"),
    stop: readPositive(body.stop, "Stop"),
  };
  const malformed = Object.values(fields).find((f) => f.error);
  if (malformed?.error) {
    return Response.json({ ok: false, error: malformed.error }, { status: 400 });
  }

  const capital = fields.capital.value ?? 2500;
  const maxSlots = Math.max(1, Math.round(fields.maxSlots.value ?? 5));
  const riskPct = fields.riskPct.value ?? 1;
  // Blank entry means "use the last close" — that is the designed default.
  const entryOverride = fields.entry.value;
  // Blank stop means the 1.5 x ATR stop. A stop that parses but sits at or above
  // the final entry is not rejected here: advise() judges it against the entry
  // it actually uses, and falls back with a card warning.
  const stopOverride = fields.stop.value;

  const { tickers: holdingTickers, notes: inputNotes } = readHoldings(body.holdings);

  const symbols = Array.from(new Set([ticker, ...holdingTickers]));

  let batch: Map<string, CandleResponse>;
  try {
    batch = await fetchCandlesBatch(symbols, "6mo", "1d");
  } catch (e) {
    return Response.json(
      { ok: false, error: `Price data could not be fetched: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const main = batch.get(ticker);
  if (!main || main.candles.length === 0) {
    return Response.json(
      { ok: false, error: `No daily price history came back for ${ticker}.` },
      { status: 502 },
    );
  }

  const holdings: HoldingInput[] = holdingTickers.map((h) => ({
    ticker: h,
    candles: batch.get(h)?.candles ?? null,
  }));

  // Two independent 2y pulls, run together because neither needs the other.
  //
  // The benchmark is the gate's input; the chart history is the ticker's own,
  // fetched AGAIN at 2y rather than reusing the 6mo batch above. That is
  // deliberate and it is not waste: the card's numbers — ATR, correlation, the
  // last close — are all computed from the 6mo series, and re-deriving them
  // from a longer one would move published figures silently. The 2y pull feeds
  // the drawing only.
  //
  // Both fail soft. A missing benchmark makes the gate read BLIND, which it is
  // already built to do; a missing chart drops the picture and leaves every
  // number on the card intact. Neither is allowed to fail the request.
  // The earnings lookup joins them for the same reason and on the same terms:
  // it never rejects and never throws — a failure comes back as a null date
  // carrying the reason, which the card prints as "unknown — <reason>" rather
  // than silently omitting the line.
  // The live quote joins on the same terms as earnings: it never rejects, and a
  // miss carries its reason to the card's fill-guard line.
  const [benchmark, chartCandles, earnings, quote] = await Promise.all([
    // 2y at 1d with a 300-day floor, so SMA200 has the 200 sessions it needs.
    fetchCandles(BENCHMARK, "2y", "1d", 300)
      .then((r) => (r.candles.length > 0 ? r.candles : null))
      .catch(() => null),
    fetchCandles(ticker, "2y", "1d", CHART_MIN_CALENDAR_DAYS)
      .then((r) => (r.candles.length > 0 ? r.candles : null))
      .catch(() => null),
    fetchNextEarnings(ticker),
    fetchLiveQuote(ticker),
  ]);

  const chart = chartCandles ? chartSeries(chartCandles) : null;

  const result = advise({
    ticker,
    candles: main.candles,
    entryOverride,
    stopOverride,
    capital,
    maxSlots,
    riskPct,
    inputNotes,
    holdings,
    benchmark,
    earnings,
    // The same 2y series the chart draws, read for gap risk only: six months
    // hold about two earnings reports, which is too few nights to find a tail.
    gapHistory: chartCandles,
    quote,
    // The route owns the clock; advise() only uses it to age the quote.
    nowSec: Math.floor(Date.now() / 1000),
  });

  // `chart` rides alongside the card rather than inside it: `advise` is pure and
  // knows nothing about drawing, and an AdviceResult must keep meaning exactly
  // what it meant before the chart existed.
  return result.ok
    ? Response.json({ ...result, chart }, { status: 200 })
    : Response.json(result, { status: 400 });
}
