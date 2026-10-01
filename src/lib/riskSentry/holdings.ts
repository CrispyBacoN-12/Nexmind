// Holdings persistence for Risk Sentry. No dedicated Prisma model exists for
// "what the owner actually holds" — an unattended cron cannot ask, so this
// reuses the generic Setting key-value table rather than adding one. See
// docs/superpowers/specs/2026-09-16-risk-sentry-design.md §1.3.

export const RISK_SENTRY_HOLDINGS_SETTING = "riskSentry:holdings";
export const RISK_SENTRY_MAX_HOLDINGS = 20;

/** No /g flag, so .test() is stateless — the same regex src/app/api/advisor/route.ts's
 *  readHoldings uses, so the two lists can never silently diverge on what counts
 *  as a valid ticker. */
const TICKER_RE = /^[A-Z][A-Z.\-]{0,9}$/;

/** Pure: validate/dedupe/uppercase/cap a raw ticker list. */
export function normalizeHoldingTickers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const t = String(h ?? "").trim().toUpperCase();
    if (t === "" || !TICKER_RE.test(t)) continue;
    if (seen.has(t)) continue;
    if (tickers.length >= RISK_SENTRY_MAX_HOLDINGS) break;
    seen.add(t);
    tickers.push(t);
  }
  return tickers;
}

/** Pure: what Risk Sentry watches = open journal positions first, then the
 *  owner's manual extras (names held outside the journal). Journal rows go first
 *  so the cap never drops a position the gates already count. */
export function mergeHoldingSources(journalOpen: string[], manual: string[]): string[] {
  return normalizeHoldingTickers([...journalOpen, ...manual]);
}

/** Tickers of every open JournalTrade (exitDate null) — the same rows
 *  /api/portfolio/evaluate treats as the book. */
export async function getJournalOpenTickers(): Promise<string[]> {
  const { prisma } = await import("@/lib/db");
  const rows = await prisma.journalTrade.findMany({ where: { exitDate: null }, select: { ticker: true } });
  return rows.map((r) => r.ticker);
}

export async function getRiskSentryHoldings(): Promise<string[]> {
  const { getSetting } = await import("@/lib/settings");
  const raw = await getSetting(RISK_SENTRY_HOLDINGS_SETTING, "[]");
  try {
    return normalizeHoldingTickers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export async function setRiskSentryHoldings(tickers: string[]): Promise<void> {
  const { setSetting } = await import("@/lib/settings");
  await setSetting(RISK_SENTRY_HOLDINGS_SETTING, JSON.stringify(normalizeHoldingTickers(tickers)));
}
