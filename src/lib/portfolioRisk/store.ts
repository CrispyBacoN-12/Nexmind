// The owner's holdings, in a git-ignored local file (.local/holdings.json).
// Not the database: the Neon DB is shared with the public site, and the owner
// chose local-only (2026-11-25). Never commit this file or its contents.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { TICKER_RE, type Parsed } from "@/lib/portfolio/journalInput";

import type { HoldingKind } from "./risk";

export interface HoldingRow {
  ticker: string;
  shares: number;
  avgCost: number;
  note: string;
  kind: HoldingKind;
  industry: string | null;
  updatedAt: string;
}

export const DEFAULT_HOLDINGS_PATH = path.join(process.cwd(), ".local", "holdings.json");

function positive(raw: unknown, label: string): Parsed<number> {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${label} must be a positive number — got "${String(raw ?? "")}".` };
  return { ok: true, value: n };
}

export function parseHoldingInput(body: Record<string, unknown>): Parsed<{ ticker: string; shares: number; avgCost: number; note: string }> {
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return { ok: false, error: "Enter a ticker symbol, e.g. AAPL." };
  const shares = positive(body.shares, "Shares");
  if (!shares.ok) return shares;
  const avgCost = positive(body.avgCost, "Cost per share");
  if (!avgCost.ok) return avgCost;
  return { ok: true, value: { ticker, shares: shares.value, avgCost: avgCost.value, note: String(body.note ?? "").trim() } };
}

/** Missing file → []. A file that is not valid JSON throws and is left untouched. */
export async function readHoldings(file = DEFAULT_HOLDINGS_PATH): Promise<HoldingRow[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("holdings file is not valid JSON");
  }
  const rows = (parsed as { holdings?: unknown }).holdings;
  if (!Array.isArray(rows)) throw new Error("holdings file has no holdings array");
  return rows as HoldingRow[];
}

async function writeHoldings(rows: HoldingRow[], file: string): Promise<HoldingRow[]> {
  const sorted = [...rows].sort((a, b) => a.ticker.localeCompare(b.ticker));
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ holdings: sorted }, null, 2)}\n`, "utf8");
  await rename(tmp, file);
  return sorted;
}

export async function upsertHolding(
  input: { ticker: string; shares: number; avgCost: number; note: string },
  file = DEFAULT_HOLDINGS_PATH,
  now: Date = new Date(),
): Promise<HoldingRow[]> {
  const rows = await readHoldings(file);
  const prev = rows.find((r) => r.ticker === input.ticker);
  const next: HoldingRow = {
    ...input,
    kind: prev?.kind ?? null,
    industry: prev?.industry ?? null,
    updatedAt: now.toISOString(),
  };
  return writeHoldings([...rows.filter((r) => r.ticker !== input.ticker), next], file);
}

export async function deleteHolding(ticker: string, file = DEFAULT_HOLDINGS_PATH): Promise<HoldingRow[]> {
  const rows = await readHoldings(file);
  return writeHoldings(rows.filter((r) => r.ticker !== ticker.toUpperCase()), file);
}

export async function setProfiles(
  updates: { ticker: string; kind: HoldingKind; industry: string | null }[],
  file = DEFAULT_HOLDINGS_PATH,
): Promise<void> {
  if (updates.length === 0) return;
  const byTicker = new Map(updates.map((u) => [u.ticker, u]));
  const rows = await readHoldings(file);
  await writeHoldings(
    rows.map((r) => {
      const u = byTicker.get(r.ticker);
      return u ? { ...r, kind: u.kind, industry: u.industry } : r;
    }),
    file,
  );
}
