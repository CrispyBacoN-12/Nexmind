// One /portfolio risk analysis run. Data sources are injected and each one can
// fail per holding without blanking the rest; every external call goes through
// `pace` so a run stays under Finnhub's free-tier limit.
// Spec: docs/superpowers/specs/2026-11-25-portfolio-risk-design.md

import { daysBetween } from "@/lib/advisor/earningsPhrase";
import type { EarningsInfo, LiveQuote } from "@/lib/advisor/types";
import { worstGapDownPct } from "./gaps";
import type { Candle } from "@/lib/indicators";
import { CORRELATION_WINDOW, dateAlignedCorrelation } from "@/lib/portfolio/marketInputs";

import {
  betaVsBenchmark,
  computeWeights,
  correlationClusters,
  industryBuckets,
  portfolioBeta,
  type Cluster,
  type HoldingKind,
  type IndustryBucket,
  type WeightRow,
} from "./risk";
import type { HoldingRow } from "./store";

/** Holdings reporting within this many calendar days are listed. */
export const EARNINGS_AHEAD_DAYS = 14;

export interface AnalysisDeps {
  liveQuote(t: string): Promise<LiveQuote>;
  earnings(t: string): Promise<EarningsInfo>;
  profile(t: string): Promise<{ kind: HoldingKind; industry: string | null; note: string | null }>;
  candles: Map<string, Candle[] | null>;
  spy: Candle[] | null;
  pace(): Promise<void>;
}

export interface AnalysisRow extends WeightRow {
  price: number;
  priceSource: "live" | "lastClose";
  priceNote: string | null;
  priceAt: string | null;
  beta: number | null;
}

export interface Missing {
  ticker: string;
  what: "price" | "profile" | "earnings" | "beta";
  reason: string;
}

export interface PortfolioAnalysis {
  asOf: string;
  total: number;
  rows: AnalysisRow[];
  top3Share: number;
  unpriced: string[];
  industries: IndustryBucket[];
  clusters: Cluster[];
  market: ReturnType<typeof portfolioBeta>;
  earnings: { ticker: string; date: string; hour: string | null; days: number; worstGapPct: number | null }[];
  missing: Missing[];
  profileUpdates: { ticker: string; kind: HoldingKind; industry: string | null }[];
}

/** Spaces calls at least 60_000 / perMinute ms apart. `now` is injectable for tests. */
export function makePacer(
  perMinute: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): () => Promise<void> {
  const gap = 60_000 / perMinute;
  let next = -Infinity;
  return async () => {
    const wait = next - now();
    if (wait > 0) await sleep(wait);
    next = Math.max(now(), next) + gap;
  };
}

const short = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 80);

export async function buildPortfolioAnalysis(holdings: HoldingRow[], deps: AnalysisDeps, todayNY: string): Promise<PortfolioAnalysis> {
  const missing: Missing[] = [];
  const profileUpdates: PortfolioAnalysis["profileUpdates"] = [];
  const profiles = new Map<string, { kind: HoldingKind; industry: string | null }>();
  const prices = new Map<string, { price: number; source: "live" | "lastClose"; note: string | null; at: string | null }>();
  const earnings: PortfolioAnalysis["earnings"] = [];

  for (const h of holdings) {
    // 1. Profile backfill for rows whose kind is still unknown.
    let kind = h.kind;
    let industry = h.industry;
    if (kind == null) {
      await deps.pace();
      try {
        const p = await deps.profile(h.ticker);
        if (p.kind != null) {
          kind = p.kind;
          industry = p.industry;
          profileUpdates.push({ ticker: h.ticker, kind, industry });
        } else {
          missing.push({ ticker: h.ticker, what: "profile", reason: p.note ?? "unknown" });
        }
      } catch (e) {
        missing.push({ ticker: h.ticker, what: "profile", reason: short(e) });
      }
    }
    profiles.set(h.ticker, { kind, industry });

    // 2. Price: live quote, else the newest daily close.
    await deps.pace();
    let live: LiveQuote;
    try {
      live = await deps.liveQuote(h.ticker);
    } catch (e) {
      live = { price: null, at: null, note: short(e) };
    }
    const last = deps.candles.get(h.ticker)?.at(-1);
    if (live.price != null && live.price > 0) {
      prices.set(h.ticker, { price: live.price, source: "live", note: null, at: live.at != null ? new Date(live.at * 1000).toISOString() : null });
    } else if (last && last.c > 0) {
      prices.set(h.ticker, {
        price: last.c,
        source: "lastClose",
        note: `live quote unavailable: ${live.note ?? "no price"}`,
        at: new Date(last.t * 1000).toISOString(),
      });
    } else {
      missing.push({ ticker: h.ticker, what: "price", reason: live.note ?? "no live quote and no daily bars" });
    }

    // 3. Earnings for stocks (ETFs have none).
    if (kind === "stock") {
      await deps.pace();
      try {
        const e = await deps.earnings(h.ticker);
        // fetchNextEarnings never throws: a refused call (429, no key) comes back
        // as date null with a reason. Only "none scheduled" means none is coming.
        if (e.date == null && !/^no report scheduled/.test(e.note ?? "")) {
          missing.push({ ticker: h.ticker, what: "earnings", reason: (e.note ?? "unknown").slice(0, 80) });
        }
        const days = e.date ? daysBetween(todayNY, e.date) : null;
        if (e.date && days != null && days >= 0 && days <= EARNINGS_AHEAD_DAYS) {
          earnings.push({ ticker: h.ticker, date: e.date, hour: e.hour, days, worstGapPct: worstGapDownPct(deps.candles.get(h.ticker) ?? null) });
        }
      } catch (e) {
        missing.push({ ticker: h.ticker, what: "earnings", reason: short(e) });
      }
    }
  }

  const weights = computeWeights(
    holdings.map((h) => ({
      ticker: h.ticker,
      shares: h.shares,
      avgCost: h.avgCost,
      price: prices.get(h.ticker)?.price ?? null,
      kind: profiles.get(h.ticker)!.kind,
      industry: profiles.get(h.ticker)!.industry,
    })),
  );

  const rows: AnalysisRow[] = weights.rows.map((w) => {
    const p = prices.get(w.ticker)!;
    const beta = betaVsBenchmark(deps.candles.get(w.ticker) ?? null, deps.spy);
    if (beta == null) missing.push({ ticker: w.ticker, what: "beta", reason: "ประวัติราคาไม่พอ" });
    return { ...w, price: p.price, priceSource: p.source, priceNote: p.note, priceAt: p.at, beta };
  });

  const weightOf = new Map(rows.map((r) => [r.ticker, r.weight]));
  // ETFs are left out: a broad fund correlates with most large caps and would
  // chain them all into one cluster. Their market sensitivity is in the beta section.
  const clusters = correlationClusters(
    rows.filter((r) => r.kind !== "etf").map((r) => r.ticker),
    (a, b) => {
      const ca = deps.candles.get(a);
      const cb = deps.candles.get(b);
      return ca && cb ? dateAlignedCorrelation(ca, cb, CORRELATION_WINDOW) : null;
    },
    (t) => weightOf.get(t) ?? 0,
  );

  return {
    asOf: todayNY,
    total: weights.total,
    rows,
    top3Share: weights.top3Share,
    unpriced: weights.unpriced,
    industries: industryBuckets(weights.rows),
    clusters,
    market: portfolioBeta(rows.map((r) => ({ ticker: r.ticker, value: r.value, beta: r.beta }))),
    earnings: earnings.sort((a, b) => a.days - b.days),
    missing,
    profileUpdates,
  };
}
