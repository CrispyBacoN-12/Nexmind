// Wires the token provider to the real world: the Setting table for storage,
// and Webull's production auth endpoint for refresh.
//
// Everything worth testing lives in token.ts (arithmetic) and tokenProvider.ts
// (decisions); this file is the thin I/O edge.

import { signedFetch } from "./auth";
import { TOKEN_SETTING_KEY, parseTokenRecord, type WebullTokenRecord } from "./token";
import { createTokenProvider, parseTokenResponse, WebullTokenUnavailableError } from "./tokenProvider";

export { WebullTokenUnavailableError };
export type { WebullTokenRecord };

/** Where the "a human must approve again" reason is parked for the War Room. */
export const TOKEN_OUTAGE_KEY = "webull:tokenOutage";

/** How long a recorded outage stays on screen — three scan ticks' worth. */
const OUTAGE_SHOW_FOR_MS = 3 * 86_400_000;

// Imported lazily: db.ts throws at module load without DATABASE_URL, and the
// pure layers must stay importable (and unit-testable) without a database.
// Same pattern as anthropic.ts's persistOutage.
async function settings() {
  return (await import("@/lib/db")).prisma.setting;
}

export async function loadWebullToken(): Promise<WebullTokenRecord | null> {
  const row = await (await settings())
    .findUnique({ where: { key: TOKEN_SETTING_KEY } })
    .catch(() => null);
  return parseTokenRecord(row?.value);
}

export async function storeWebullToken(rec: WebullTokenRecord): Promise<void> {
  const value = JSON.stringify(rec);
  await (await settings()).upsert({
    where: { key: TOKEN_SETTING_KEY },
    create: { key: TOKEN_SETTING_KEY, value },
    update: { value },
  });
}

/** Fire-and-forget: failing to record an outage must not also fail the call
 *  that discovered it — the caller still has a fallback provider to reach. */
function persistOutage(reason: string | null): void {
  void (async () => {
    const s = await settings();
    if (reason) {
      const value = JSON.stringify({ reason, at: Date.now() });
      await s.upsert({ where: { key: TOKEN_OUTAGE_KEY }, create: { key: TOKEN_OUTAGE_KEY, value }, update: { value } });
    } else {
      await s.deleteMany({ where: { key: TOKEN_OUTAGE_KEY } });
    }
  })().catch(() => {});
}

/** Why Webull data is unavailable, for the War Room banner. Null when healthy. */
export async function webullTokenOutage(): Promise<{ reason: string; at: number } | null> {
  const row = await (await settings())
    .findUnique({ where: { key: TOKEN_OUTAGE_KEY } })
    .catch(() => null);
  if (!row) return null;
  try {
    const { reason, at } = JSON.parse(row.value) as { reason: string; at: number };
    if (typeof reason !== "string") return null;
    // ensureWebullTokenFresh re-raises or clears this every scan tick, so a row
    // older than that is not a live warning — it is a leftover from a desk that
    // has stopped scanning, and showing it would just train the eye to ignore
    // the banner.
    return Date.now() - at < OUTAGE_SHOW_FOR_MS ? { reason, at } : null;
  } catch {
    return null;
  }
}

/** Production host + app credentials. Distinct from the sandbox pair: sandbox
 *  rejects these with 401 UNAUTHORIZED, and vice versa. */
export function productionCreds(): { baseUrl: string; appKey: string; appSecret: string } {
  const baseUrl = process.env.WEBULL_BASE_URL;
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!baseUrl || !appKey || !appSecret) {
    throw new WebullTokenUnavailableError("missing WEBULL_BASE_URL / WEBULL_APP_KEY / WEBULL_APP_SECRET");
  }
  return { baseUrl, appKey, appSecret };
}

/** One refresh round trip. The token goes in the body AND the x-access-token
 *  header — that is the combination measured to return 200; body alone was
 *  refused. Whatever token comes back is the one to keep: Webull sometimes
 *  returns the same string with a later expiry and sometimes a new string. */
export async function refreshWebullToken(rec: WebullTokenRecord): Promise<WebullTokenRecord> {
  const { baseUrl, appKey, appSecret } = productionCreds();
  const res = await signedFetch("/openapi/auth/token/refresh", {
    baseUrl,
    method: "POST",
    appKey,
    appSecret,
    body: { token: rec.token },
    accessToken: rec.token,
  });
  if (!res.ok) throw new Error(`token/refresh upstream ${res.status}`);
  const next = parseTokenResponse(await res.json().catch(() => null));
  if (!next) throw new Error("token/refresh did not return a NORMAL token");
  return next;
}

const provider = createTokenProvider({
  now: () => Date.now(),
  load: loadWebullToken,
  store: storeWebullToken,
  refresh: refreshWebullToken,
  onOutage: persistOutage,
});

/** The token to sign production market-data calls with, refreshed when it is
 *  inside its runway. Throws WebullTokenUnavailableError when Webull cannot be
 *  used at all, which the provider router treats as a miss. */
export function getWebullAccessToken(): Promise<string> {
  return provider.get();
}

/** Forget the cached token — used by the seed script after it writes a new one. */
export function resetWebullTokenCache(): void {
  provider.reset();
}

/**
 * Roll the token forward on a schedule that does not depend on Webull being
 * reached for data.
 *
 * This is not belt-and-braces, it is the whole mechanism. Alpaca leads the
 * provider chain and is healthy, so fetchWebullCandles is essentially never
 * called for a US equity — which means nothing would ever ask for the token,
 * which means it would quietly die 15 days after seeding and the fallback
 * provider would be gone exactly when Alpaca finally needed cover. Call this
 * once per scan tick instead.
 *
 * Never throws: an unusable token is a logged, banner-raising condition, not a
 * reason to fail a scan that has nothing to do with Webull.
 */
export async function ensureWebullTokenFresh(): Promise<void> {
  if (!process.env.WEBULL_APP_KEY || !process.env.WEBULL_APP_SECRET) return;
  try {
    await provider.get();
  } catch (e) {
    console.warn(`webull: ${e instanceof Error ? e.message : e}`);
  }
}
