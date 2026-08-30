// Webull production session token: storage, expiry arithmetic, unattended refresh.
//
// WHY THIS EXISTS — AND WHY THE OLD "IMPOSSIBLE" VERDICT WAS WRONG
//
// webull.ts signed against the sandbox/UAT host because the production host
// answers INVALID_TOKEN without an x-access-token, and that token needs a tap
// in the Webull mobile app. That was read as "per session, so a cron can never
// hold one". Measured end to end on 2026-08-30, it is not:
//
//   POST /openapi/auth/token/create   -> 200 PENDING, ~6 minute approval window
//   (tap in the app) then /token/check -> NORMAL
//   a NORMAL token lives              -> exactly 15.00 days
//   POST /openapi/auth/token/refresh  -> 200, new token, NORMAL, +15 days,
//                                        with NO second approval
//
// So a human is needed exactly once, to seed the first token; after that this
// module rolls it forward on its own.
//
// Staying on sandbox was not a safe fallback: its bars are a partially
// refreshed fixture set. Of 50 large caps, 15 were stale — nine frozen at
// 2026-07-15, and PM/CSX/HON/LOW/AXP frozen since 2024-09..2025-01 — with
// price errors from 1.3% to 39.8% (RTX 127.50 against a real 211.71). Sandbox
// never errors on those, so nothing downstream could tell. Production returned
// the correct figure for every one.
//
// Refresh MAY rotate the token: it returned the same string on 2026-08-30 with
// only the expiry moved out, and a different one on an earlier call. So the
// response's token is always what gets persisted — never assume the stored one
// is still current, and never assume it isn't.

/** Namespaced so it cannot collide with another Setting row. */
export const TOKEN_SETTING_KEY = "webull:accessToken";

/**
 * Refresh once fewer than 7 of the 15 days remain.
 *
 * Deliberately not "when it is about to expire". The scan runs daily, so this
 * leaves ~7 further attempts after the first failure before the token actually
 * dies and a human is needed again. A threshold measured in hours would turn
 * one bad night into a manual re-approval.
 */
export const REFRESH_WHEN_UNDER_MS = 7 * 86_400_000;

export interface WebullTokenRecord {
  token: string;
  /** Epoch ms, straight from Webull's `expires_at`. */
  expiresAt: number;
}

/**
 * Read a stored row back, or null for anything malformed.
 *
 * A corrupt row must degrade to "no Webull token" — and so to the next
 * provider — never throw into a scan tick that had a good Alpaca answer
 * waiting.
 */
export function parseTokenRecord(value: string | null | undefined): WebullTokenRecord | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { token, expiresAt } = parsed as Record<string, unknown>;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { token, expiresAt };
}

/** Has the 15-day life actually run out? */
export function isExpired(rec: WebullTokenRecord, now: number): boolean {
  return rec.expiresAt <= now;
}

/**
 * Should a refresh be attempted now? True for an already-expired token too:
 * Webull may still honour it, the attempt costs one request, and the
 * alternative is guaranteed failure.
 */
export function needsRefresh(rec: WebullTokenRecord, now: number): boolean {
  return rec.expiresAt - now < REFRESH_WHEN_UNDER_MS;
}
