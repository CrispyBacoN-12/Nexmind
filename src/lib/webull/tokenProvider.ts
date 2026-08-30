// The moving part of the Webull token: decide whether to refresh, do it once,
// and never let a transient failure cost us a provider.
//
// Split from token.ts so the decision logic can be tested against fakes rather
// than against Neon and Webull's live auth endpoint. The wiring to the real
// Setting row and the real HTTP call is in webullToken.ts.

import { isExpired, needsRefresh, type WebullTokenRecord } from "./token";

/** Webull cannot be used at all. Callers fall through to the next provider;
 *  the message is what the War Room banner shows. */
export class WebullTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebullTokenUnavailableError";
  }
}

/** Read a create / check / refresh response body into a record.
 *  Anything not NORMAL is not usable — PENDING in particular means the human
 *  has not tapped approve yet. */
export function parseTokenResponse(json: unknown): WebullTokenRecord | null {
  if (!json || typeof json !== "object") return null;
  const { token, expires_at: expiresAt, status } = json as Record<string, unknown>;
  if (status !== "NORMAL") return null;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { token, expiresAt };
}

export interface TokenProviderDeps {
  now: () => number;
  load: () => Promise<WebullTokenRecord | null>;
  store: (rec: WebullTokenRecord) => Promise<void>;
  refresh: (rec: WebullTokenRecord) => Promise<WebullTokenRecord>;
  /** Raise (string) or clear (null) the "a human is needed" banner. */
  onOutage: (reason: string | null) => void;
}

const SEED_HINT = "run `npx tsx scripts/webull-seed-token.mts` and approve in the Webull app";

export interface TokenProvider {
  get: () => Promise<string>;
  /** Test seam / manual reset: forget the cached token. */
  reset: () => void;
}

export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  // A universe scan fetches ~200 symbols at once. Without single-flighting,
  // each would notice the same expiring token and fire its own refresh — 200
  // needless auth calls, and, on the refreshes that do hand back a new string,
  // all but one caller left holding a token Webull had just retired. The
  // in-process cache is the same economy applied to the DB read.
  let inflight: Promise<string> | null = null;
  let cached: WebullTokenRecord | null = null;

  async function resolve(): Promise<string> {
    const stored = cached ?? (await deps.load());
    if (!stored) {
      const why = `no Webull token stored — ${SEED_HINT}`;
      deps.onOutage(why);
      throw new WebullTokenUnavailableError(why);
    }
    if (!needsRefresh(stored, deps.now())) {
      cached = stored;
      deps.onOutage(null);
      return stored.token;
    }
    try {
      const next = await deps.refresh(stored);
      await deps.store(next);
      cached = next;
      deps.onOutage(null);
      return next.token;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const now = deps.now();
      if (!isExpired(stored, now)) {
        // Inside the runway but not dead: keep trading on it and retry on the
        // next tick. Warn with the countdown so a week of quiet failures is
        // visible before it becomes a manual re-approval.
        const daysLeft = (stored.expiresAt - now) / 86_400_000;
        deps.onOutage(
          `Webull token refresh failing (${detail}) — ${daysLeft.toFixed(1)} days left before re-approval is needed`,
        );
        cached = stored;
        return stored.token;
      }
      cached = null;
      const why = `Webull token expired and refresh failed (${detail}) — ${SEED_HINT}`;
      deps.onOutage(why);
      throw new WebullTokenUnavailableError(why);
    }
  }

  return {
    async get() {
      if (inflight) return inflight;
      if (cached && !needsRefresh(cached, deps.now())) return cached.token;
      inflight = resolve().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    reset() {
      cached = null;
      inflight = null;
    },
  };
}
