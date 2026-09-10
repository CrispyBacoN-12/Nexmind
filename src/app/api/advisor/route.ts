// The advisory tool's only I/O. Everything in src/lib/advisor/ is pure and
// takes candle arrays; this route is what fetches them.
//
// The benchmark is fetched on its own rather than folded into the batch: SMA200
// needs 200 sessions (~290 calendar days), fetchCandlesBatch takes no minDays,
// and a "6mo" SPY would make the gate read BLIND on every request with nobody
// the wiser.

import { advise } from "@/lib/advisor/advise";
import type { HoldingInput } from "@/lib/advisor/types";
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

  // 2y at 1d with a 300-day floor, so SMA200 has the 200 sessions it needs.
  const benchmark = await fetchCandles(BENCHMARK, "2y", "1d", 300)
    .then((r) => (r.candles.length > 0 ? r.candles : null))
    .catch(() => null);

  const result = advise({
    ticker,
    candles: main.candles,
    entryOverride,
    capital,
    maxSlots,
    riskPct,
    inputNotes,
    holdings,
    benchmark,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
