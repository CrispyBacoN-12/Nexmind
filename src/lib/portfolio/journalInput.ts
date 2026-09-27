// Validation for what the owner types into the journal, and the journal ->
// PortfolioSlot adapter. Pure. Same rule as the advisor route: a field that is
// present but malformed is an error, never a silent default — a mistyped NAV
// would move the drawdown gate with nothing on screen to give it away.

import { GICS_SECTORS, type ResolvedSector } from "./sectorMap";
import type { NavPoint, PortfolioSlot } from "./types";

const TICKER_RE = /^[A-Z][A-Z.\-]{0,9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function num(raw: unknown, label: string, opts: { optional?: boolean; integer?: boolean } = {}): Parsed<number | null> {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return opts.optional ? { ok: true, value: null } : { ok: false, error: `${label} is required.` };
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${label} must be a positive number — got "${String(raw)}".` };
  if (opts.integer && !Number.isInteger(n)) return { ok: false, error: `${label} must be whole shares — got "${String(raw)}".` };
  return { ok: true, value: n };
}

function date(raw: unknown, label: string): Parsed<string> {
  const s = String(raw ?? "").trim();
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    return { ok: false, error: `${label} must be a date as YYYY-MM-DD — got "${s}".` };
  }
  return { ok: true, value: s };
}

export interface OpenTradeInput {
  ticker: string;
  shares: number;
  entryPrice: number;
  entryDate: string;
  stop: number;
  note: string;
}

export function parseOpenTrade(body: Record<string, unknown>): Parsed<OpenTradeInput> {
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return { ok: false, error: "Enter a ticker symbol, e.g. AAPL." };
  const shares = num(body.shares, "Shares", { integer: true });
  if (!shares.ok) return shares;
  const entryPrice = num(body.entryPrice, "Entry price");
  if (!entryPrice.ok) return entryPrice;
  const stop = num(body.stop, "Stop");
  if (!stop.ok) return stop;
  if (stop.value! >= entryPrice.value!) return { ok: false, error: "Stop must be below the entry price (long only)." };
  const entryDate = date(body.entryDate, "Entry date");
  if (!entryDate.ok) return entryDate;
  return {
    ok: true,
    value: {
      ticker,
      shares: shares.value!,
      entryPrice: entryPrice.value!,
      entryDate: entryDate.value,
      stop: stop.value!,
      note: String(body.note ?? "").trim().slice(0, 500),
    },
  };
}

export function parseCloseTrade(body: Record<string, unknown>, entryDate: string): Parsed<{ exitPrice: number; exitDate: string }> {
  const exitPrice = num(body.exitPrice, "Exit price");
  if (!exitPrice.ok) return exitPrice;
  const exitDate = date(body.exitDate, "Exit date");
  if (!exitDate.ok) return exitDate;
  if (exitDate.value < entryDate) return { ok: false, error: `Exit date ${exitDate.value} is before the entry date ${entryDate}.` };
  return { ok: true, value: { exitPrice: exitPrice.value!, exitDate: exitDate.value } };
}

export function parseNavEntry(body: Record<string, unknown>): Parsed<{ date: string; nav: number; cash: number | null; note: string }> {
  const d = date(body.date, "Date");
  if (!d.ok) return d;
  const nav = num(body.nav, "NAV");
  if (!nav.ok) return nav;
  const cash = num(body.cash, "Cash", { optional: true });
  if (!cash.ok) return cash;
  if (cash.value != null && cash.value > nav.value!) return { ok: false, error: "Cash cannot exceed NAV." };
  return { ok: true, value: { date: d.value, nav: nav.value!, cash: cash.value, note: String(body.note ?? "").trim().slice(0, 500) } };
}

/** Closed trade result in R: (exit - entry) / (entry - stop). */
export function realizedR(t: { entryPrice: number; stop: number; exitPrice: number }): number {
  return (t.exitPrice - t.entryPrice) / (t.entryPrice - t.stop);
}

export interface JournalRow {
  ticker: string;
  sector: string;
  shares: number;
  entryPrice: number;
  stop: number;
  worstLossR: number | null;
  exitDate: string | null;
}

/** Open journal rows as the book the gates evaluate. An unrecognised stored sector reads as Other. */
export function slotsFromJournal(rows: JournalRow[]): PortfolioSlot[] {
  return rows
    .filter((r) => r.exitDate == null)
    .map((r) => ({
      ticker: r.ticker,
      sector: resolveStoredSector(r.sector),
      shares: r.shares,
      entry: r.entryPrice,
      stop: r.stop,
      worstLossR: r.worstLossR,
    }));
}

/** Stored sectors are GICS names resolved at entry; anything else reads as unknown. */
function resolveStoredSector(s: string): ResolvedSector {
  return (GICS_SECTORS as readonly string[]).includes(s) ? (s as ResolvedSector) : "Other";
}

export function navPoints(rows: Array<{ date: string; nav: number }>): NavPoint[] {
  return rows.map((r) => ({ date: r.date, nav: r.nav }));
}
