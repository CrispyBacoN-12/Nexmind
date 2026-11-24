// Pure portfolio-risk math for the local-only /portfolio page. Shows how the
// book is concentrated and how it moved with the market; never says what to
// buy, sell or trim.
// Spec: docs/superpowers/specs/2026-11-25-portfolio-risk-design.md

import type { Candle } from "@/lib/indicators";
import { returnsByDate } from "@/lib/portfolio/marketInputs";
import { CORRELATION_ALERT_THRESHOLD } from "@/lib/riskSentry/correlationAlert";

/** Display flags (neutral colour, no advice text). */
export const HOLDING_FLAG = 0.2;
export const INDUSTRY_FLAG = 0.3;
export const CLUSTER_FLAG = 0.3;
/** Beta: last 252 shared daily returns, at least 120. */
export const BETA_WINDOW = 252;
export const BETA_MIN_DAYS = 120;
/** The market-drop scenario: SPY −10%. */
export const SCENARIO_SPY_MOVE = -0.1;

const EPS = 1e-12;

export type HoldingKind = "stock" | "etf" | null;

export interface PricedHolding {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number | null;
  kind: HoldingKind;
  industry: string | null;
}

export interface WeightRow {
  ticker: string;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  weight: number;
  flagged: boolean;
  kind: HoldingKind;
  industry: string | null;
}

export function computeWeights(rows: PricedHolding[]): { total: number; rows: WeightRow[]; top3Share: number; unpriced: string[] } {
  const priced = rows.filter((r) => r.price != null && Number.isFinite(r.price) && r.price > 0);
  const unpriced = rows.filter((r) => !priced.includes(r)).map((r) => r.ticker);
  const total = priced.reduce((s, r) => s + r.shares * r.price!, 0);
  const out: WeightRow[] = priced.map((r) => {
    const value = r.shares * r.price!;
    const cost = r.shares * r.avgCost;
    const weight = total > 0 ? value / total : 0;
    return {
      ticker: r.ticker,
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost > 0 ? (value - cost) / cost : 0,
      weight,
      flagged: weight >= HOLDING_FLAG - EPS,
      kind: r.kind,
      industry: r.industry,
    };
  });
  out.sort((a, b) => b.value - a.value);
  const top3Share = out.slice(0, 3).reduce((s, r) => s + r.weight, 0);
  return { total, rows: out, top3Share, unpriced };
}

export interface IndustryBucket {
  label: string;
  kind: "industry" | "etf" | "unknown";
  value: number;
  weight: number;
  tickers: string[];
  flagged: boolean;
}

export const ETF_LABEL = "ETF / กองทุน";
export const UNKNOWN_LABEL = "ยังไม่ทราบกลุ่ม";

/** Value by Finnhub industry. ETFs are their own bucket and are never flagged: a fund is diversification. */
export function industryBuckets(rows: WeightRow[]): IndustryBucket[] {
  const buckets = new Map<string, IndustryBucket>();
  for (const r of rows) {
    const kind: IndustryBucket["kind"] = r.kind === "etf" ? "etf" : r.kind == null || !r.industry ? "unknown" : "industry";
    const label = kind === "etf" ? ETF_LABEL : kind === "unknown" ? UNKNOWN_LABEL : r.industry!;
    const key = `${kind}|${label}`;
    const b = buckets.get(key) ?? { label, kind, value: 0, weight: 0, tickers: [], flagged: false };
    b.value += r.value;
    b.weight += r.weight;
    b.tickers.push(r.ticker);
    buckets.set(key, b);
  }
  const out = [...buckets.values()];
  for (const b of out) b.flagged = b.kind === "industry" && b.weight >= INDUSTRY_FLAG - EPS;
  return out.sort((a, b) => b.weight - a.weight);
}

/** cov(stock, bench) / var(bench) over the last `window` dates both series have a return. */
export function betaVsBenchmark(
  stock: Candle[] | null,
  bench: Candle[] | null,
  window = BETA_WINDOW,
  minDays = BETA_MIN_DAYS,
): number | null {
  if (!stock || !bench) return null;
  const rs = returnsByDate(stock);
  const rb = returnsByDate(bench);
  const dates = [...rs.keys()].filter((d) => rb.has(d)).sort().slice(-window);
  if (dates.length < minDays) return null;
  const x = dates.map((d) => rs.get(d)!);
  const y = dates.map((d) => rb.get(d)!);
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let cov = 0;
  let vy = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    vy += (y[i] - my) ** 2;
  }
  return vy === 0 ? null : cov / vy;
}

export interface BetaInput {
  ticker: string;
  value: number;
  beta: number | null;
}

/**
 * Value-weighted beta over the holdings that have one, and the $ / % move if
 * SPY moves SCENARIO_SPY_MOVE. Holdings without beta are excluded and listed,
 * never assumed to be beta 1. scenarioPct is over ALL holdings' value.
 */
export function portfolioBeta(rows: BetaInput[]): {
  beta: number | null;
  scenarioUsd: number;
  scenarioPct: number | null;
  excluded: string[];
  excludedValue: number;
} {
  const measured = rows.filter((r) => r.beta != null && Number.isFinite(r.beta));
  const excludedRows = rows.filter((r) => !measured.includes(r));
  const measuredValue = measured.reduce((s, r) => s + r.value, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const scenarioUsd = measured.reduce((s, r) => s + r.value * r.beta! * SCENARIO_SPY_MOVE, 0);
  return {
    beta: measuredValue > 0 ? measured.reduce((s, r) => s + r.value * r.beta!, 0) / measuredValue : null,
    scenarioUsd,
    scenarioPct: totalValue > 0 ? scenarioUsd / totalValue : null,
    excluded: excludedRows.map((r) => r.ticker),
    excludedValue: excludedRows.reduce((s, r) => s + r.value, 0),
  };
}

export interface Cluster {
  members: string[];
  weight: number;
  flagged: boolean;
  strongest: { a: string; b: string; r: number };
}

/** Connected components of the graph whose edges have correlation ≥ threshold; 2+ members only. */
export function correlationClusters(
  tickers: string[],
  corr: (a: string, b: string) => number | null,
  weightOf: (t: string) => number,
  threshold = CORRELATION_ALERT_THRESHOLD,
): Cluster[] {
  const parent = new Map(tickers.map((t) => [t, t]));
  const find = (t: string): string => {
    while (parent.get(t) !== t) t = parent.get(t)!;
    return t;
  };
  const edges: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = corr(tickers[i], tickers[j]);
      if (r == null || !Number.isFinite(r) || r < threshold) continue;
      edges.push({ a: tickers[i], b: tickers[j], r });
      parent.set(find(tickers[i]), find(tickers[j]));
    }
  }
  const groups = new Map<string, string[]>();
  for (const t of tickers) groups.set(find(t), [...(groups.get(find(t)) ?? []), t]);

  const out: Cluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const set = new Set(members);
    const strongest = edges.filter((e) => set.has(e.a)).sort((x, y) => y.r - x.r)[0];
    const weight = members.reduce((s, t) => s + weightOf(t), 0);
    out.push({ members, weight, flagged: weight >= CLUSTER_FLAG - EPS, strongest });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
