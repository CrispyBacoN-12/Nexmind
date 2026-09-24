// The facts sheet RAVEN argues about.
//
// Everything here was produced by this server one request earlier: the card the
// owner is looking at, and the bars already drawn under it. Nothing is fetched
// and nothing is recomputed, so the numbers RAVEN argues about are byte-for-byte
// the numbers on the owner's screen.
//
// buildAnalystContext is NOT reused: it takes a ScanResult, which the advisor
// never produces. The advisor gets its own, much smaller renderer.
//
// Every number is formatted here, once, with local helpers rather than with
// fmtPct/fmtMoney. fmtPct divides by 100, and every *Pct field in this codebase
// is already in percent units; keeping that convention out of the model's input
// removes a whole class of silently-wrong number.
//
// Pure — no prisma, no market data, no clock.

import type { ChartBar } from "@/lib/advisor/chartSeries";
import { earningsPhrase } from "@/lib/advisor/earningsPhrase";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
} from "@/lib/advisor/types";
// Type-only: erased at compile time, so this stays true to "no market data" —
// the caller fetches, this module only knows the shape of what it renders.
import type { Fundamentals } from "@/lib/market/fundamentals";
import type { RecentNews } from "@/lib/market/news";

export type Severity = "note" | "concern" | "serious";

export interface Objection {
  /** What is wrong with this structure. One sentence. */
  claim: string;
  /** The number from the card or the facts sheet that supports the claim. */
  evidence: string;
  severity: Severity;
}

export interface CritiqueResult {
  /** 0-4. Zero is a legitimate answer and is rendered as such. */
  objections: Objection[];
  /** What the card cannot see at all: sector-wide moves, options positioning,
   *  the macro calendar. Earnings came off this list on 2026-09-14 (the
   *  [head] block carries the date); fundamentals and company news came off
   *  on 2026-09-15 (the [fundamentals] and [news] blocks carry them). */
  blindSpots: string[];
  /** True when the AI backend was unavailable or the call failed. */
  degraded: boolean;
  note: string;
  /** Claims the guard stripped, verbatim, so a muzzled model is visible. */
  stripped: string[];
  model: string;
  costUsd: number;
}

/** Bars in the "recent" sub-window of the range block. */
const RECENT_BARS = 20;

const NA = "n/a";

function num(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? NA : v.toFixed(digits);
}

/** The value is ALREADY in percent units. Do not scale it. */
function pct(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? NA : `${v.toFixed(digits)}%`;
}

function usd(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? NA : `$${v.toFixed(2)}`;
}

function yesNo(v: boolean | null): string {
  return v == null ? NA : v ? "yes" : "no";
}

export function renderCritiqueContext(
  card: AdvisorCard,
  chart: ChartBar[] | null,
  fundamentals?: Fundamentals | null,
  news?: RecentNews | null,
): string {
  const s = card.sizing;
  const atrPctOfEntry = card.entry > 0 ? (card.atr / card.entry) * 100 : null;

  const lines: string[] = [
    "[head]",
    `ticker: ${card.ticker}`,
    `as of: ${card.asOf}`,
    `last close: ${usd(card.lastClose)}`,
    `entry: ${usd(card.entry)} (${card.entrySource})`,
    `already held: ${card.alreadyHeld ? "yes" : "no"}`,
    // The only non-price fact on the sheet, and the only one whose absence is
    // itself informative — which is why it is printed even when it is unknown
    // rather than omitted. A missing line reads as "nothing to say here"; an
    // "unknown" line reads as "go and check", which is the truth.
    `next earnings: ${earningsPhrase(card.earnings, card.asOf)}`,
    "",
    "[risk]",
    `ATR(${ADVISOR_ATR_PERIOD}): ${num(card.atr)} (${pct(atrPctOfEntry)} of entry)`,
    `stop distance: ${num(card.slDistance)} (${ADVISOR_ATR_SL_MULT} x ATR)`,
    `stop: ${usd(card.stop)}`,
    `round-trip cost at ${ADVISOR_COST_BPS} bps: ${num(card.costR)} R`,
    // Printed as n/a rather than omitted, for the same reason as earnings.
    card.gapRisk
      ? `worst overnight gap-through (${card.gapRisk.from} to ${card.gapRisk.to}, ${card.gapRisk.sessions} sessions): ` +
        `${num(card.gapRisk.worstStops)} stops on ${card.gapRisk.worstDate ?? NA}, i.e. up to ${num(card.gapRisk.worstLossR)} R ` +
        `(${card.gapRisk.overOneStop} sessions gapped a full stop or more)`
      : `worst overnight gap-through: ${NA}`,
    "",
    "[sizing]",
    `shares: ${s.shares}`,
    `bound by: ${s.boundBy.length > 0 ? s.boundBy.join(", ") : NA}`,
    `slot budget: ${usd(s.slotBudget)}`,
    `risk target: ${usd(s.riskUsdTarget)}`,
    `actual risk: ${usd(s.actualRiskUsd)} (${pct(s.actualRiskPct)} of capital)`,
    `risk-only shares: ${s.riskShares} / affordable shares: ${s.affordableShares}`,
    `deployed: ${usd(card.deployedUsd)}`,
    `sizing reason: ${s.reason}`,
    "",
    "[ladder]",
  ];

  if (card.ladder.length === 0) {
    lines.push(NA);
  } else {
    for (const row of card.ladder) {
      lines.push(`${num(row.r, 1)} R · ${usd(row.price)} · ${pct(row.gainPct)} · ${usd(row.plUsd)}`);
    }
  }

  lines.push("", "[portfolio]");
  if (card.correlations.length === 0) {
    lines.push(`correlations: ${NA}`);
  } else {
    for (const c of card.correlations) {
      lines.push(`correlation vs ${c.ticker}: ${num(c.correlation)} — ${c.note}`);
    }
  }
  lines.push(
    `average correlation: ${num(card.avgCorrelation)}`,
    `correlation multiplier: ${num(card.corrMultiplier)} — REPORTED ONLY, not applied to the share count above`,
    `correlation-adjusted shares: ${card.corrAdjustedShares} — REPORTED ONLY, not applied`,
    `free slots: ${card.freeSlots}`,
    "",
    "[regime]",
    `slots allowed by the market gate: ${card.gate.slots}`,
    `benchmark above its own trend: ${yesNo(card.gate.benchAbove)}`,
    `shorts allowed: ${yesNo(card.gate.shortsAllowed)}`,
    `gate note: ${card.gate.note}`,
    "",
    "[position in range]",
    ...rangeBlock(card, chart),
    "",
    "[fundamentals]",
    ...fundamentalsBlock(fundamentals),
    "",
    "[news]",
    ...newsBlock(news),
    "",
    "[warnings]",
  );

  if (card.warnings.length === 0) {
    lines.push("none");
  } else {
    for (const w of card.warnings) lines.push(`- ${w}`);
  }

  return lines.join("\n");
}

/**
 * Where the last close sits inside the history the client was actually given.
 *
 * The spec called this the "52-week" range; the chart the route hands back is
 * chartSeries()'s last CHART_VISIBLE_BARS bars — about six months. Labelling a
 * six-month range as 52 weeks would be the kind of quietly wrong number this
 * tool exists not to print, so the block names the window it measured.
 */
function rangeBlock(card: AdvisorCard, chart: ChartBar[] | null): string[] {
  if (chart == null || chart.length === 0) {
    return [
      `bars supplied: ${NA}`,
      `last close vs SMA50: ${NA}`,
      `last close vs SMA200: ${NA}`,
      `range over the supplied bars: ${NA}`,
      `last ${RECENT_BARS} bars: ${NA}`,
      "no chart history was supplied with this card, so nothing about position in range is known",
    ];
  }

  const first = chart[0]!;
  const last = chart[chart.length - 1]!;
  const vsSma = (mean: number | null): string =>
    mean == null || mean === 0 ? NA : pct(((last.c - mean) / mean) * 100);

  const hi = Math.max(...chart.map((b) => b.h));
  const lo = Math.min(...chart.map((b) => b.l));
  const span = hi - lo;
  const recent = chart.slice(-RECENT_BARS);

  const out = [
    `bars supplied: ${chart.length} daily bars, ${first.d} to ${last.d}`,
    `last close vs SMA50: ${vsSma(last.sma50)} (SMA50 ${num(last.sma50)})`,
    `last close vs SMA200: ${vsSma(last.sma200)} (SMA200 ${num(last.sma200)})`,
    `range over the supplied bars: high ${usd(hi)} / low ${usd(lo)}; last close sits at ` +
      `${pct(span > 0 ? ((last.c - lo) / span) * 100 : null)} of that range`,
    `last ${recent.length} bars: high ${usd(Math.max(...recent.map((b) => b.h)))} / ` +
      `low ${usd(Math.min(...recent.map((b) => b.l)))}`,
  ];

  // The rung the whole ladder depends on, against the highest price this name
  // has actually printed in the window. This is the MDLZ-style argument.
  const topRung = card.ladder.length > 0 ? card.ladder[card.ladder.length - 1]! : null;
  if (topRung != null) {
    out.push(
      `highest ladder target ${usd(topRung.price)} vs the highest high in the supplied window ${usd(hi)}`,
    );
  }
  return out;
}

/**
 * Three distinct states, never collapsed into one another: `undefined` means
 * the caller did not fetch fundamentals at all (an old caller, or a route
 * that chose to skip it); `note` set means the fetch ran and found nothing
 * usable; otherwise every metric renders. Collapsing "not fetched" into "no
 * data" would read to the model as a clean bill of health it was never given.
 */
function fundamentalsBlock(f: Fundamentals | null | undefined): string[] {
  if (f == null) return ["not fetched for this critique"];
  if (f.note) return [f.note];
  return [
    `name: ${f.name ?? NA} (${f.industry ?? NA})`,
    `market cap: ${f.marketCapM == null ? NA : `$${f.marketCapM.toFixed(0)}M`}`,
    `P/E (TTM): ${num(f.peTTM)}`,
    `P/B: ${num(f.pb)}`,
    `ROE: ${pct(f.roePct)}`,
    `net margin: ${pct(f.netMarginPct)}`,
    `revenue growth: ${pct(f.revenueGrowthPct)}`,
    `EPS growth: ${pct(f.epsGrowthPct)}`,
    `debt/equity: ${num(f.debtToEquity)}`,
    `dividend yield: ${pct(f.dividendYieldPct)}`,
  ];
}

/** Same three-state shape as fundamentalsBlock, for the same reason. */
function newsBlock(n: RecentNews | null | undefined): string[] {
  if (n == null) return ["not fetched for this critique"];
  if (n.items.length === 0) return [n.note ?? "no recent company news"];
  return n.items.map((it) => `${it.date} (${it.source}): ${it.headline}`);
}

// ---------------------------------------------------------------------------
// The guard, and the reason ADVISOR_NO_EDGE_CLAIM survives having an AI on the
// same screen.
//
// The system prompt also forbids this language. The guard exists because a
// prompt is not an enforcement mechanism. Presence of the vocabulary is the
// whole test — no sentiment analysis, so "you should not buy this" is stripped
// exactly like "you should buy this", because a negated verdict is a verdict.
// A false strip costs one objection, which is cheap; a leaked recommendation
// costs the claim printed four lines below it.
// ---------------------------------------------------------------------------

/** Word-boundary matched, case-insensitive. */
const GUARD_WORDS_EN: readonly string[] = [
  "buy",
  "buying",
  "sell",
  "selling",
  "long",
  "short",
  "enter",
  "entering",
  "avoid",
  "recommend",
  "recommendation",
  "suggest",
  "should",
  "worth it",
  "take this trade",
];

/**
 * Plain substring matched. Thai is written without spaces, so a \b anchor
 * never fires against it and would silently disable this entire half of the
 * list while still looking like it worked.
 */
const GUARD_WORDS_TH: readonly string[] = [
  "ควรซื้อ",
  "น่าซื้อ",
  "ควรเข้า",
  "น่าเข้า",
  "ควรขาย",
  "ไม่ควร",
  "แนะนำ",
  "น่าลงทุน",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** No /g flag: a global regex carries lastIndex between .test() calls. */
const GUARD_RE_EN = new RegExp(`\\b(?:${GUARD_WORDS_EN.map(escapeRe).join("|")})\\b`, "i");

/** Exported for the tests and for anything that wants to explain a strip. */
export function isDirectional(text: string): boolean {
  if (GUARD_RE_EN.test(text)) return true;
  return GUARD_WORDS_TH.some((w) => text.includes(w));
}

/**
 * Remove every objection that recommends rather than objects.
 *
 * Stripping is visible, never silent: the removed text is returned verbatim so
 * the UI can say how many times the model had to be muzzled. A model that has
 * to be muzzled is information about the model.
 */
export function guardObjections(objections: Objection[]): { kept: Objection[]; stripped: string[] } {
  const kept: Objection[] = [];
  const stripped: string[] = [];
  for (const o of objections) {
    if (isDirectional(`${o.claim} ${o.evidence}`)) {
      stripped.push(`${o.claim} — ${o.evidence}`);
    } else {
      kept.push(o);
    }
  }
  return { kept, stripped };
}
