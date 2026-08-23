// Shared HMAC-SHA256 request signing for Webull's OpenAPI.
// Kept as its own module so the signing algorithm has one home.
// Algorithm verified against webull-inc/webull-openapi-python-sdk's
// default_signature_composer + token_manager (see scripts/webull-account-list.mts
// for the original reference implementation this was ported from, including
// the x-access-token exchange that some endpoints/environments require).
import { createHmac, createHash, randomUUID } from "node:crypto";

/** How long any single Webull call may take before it is aborted. Short on
 *  purpose: every caller has a fallback provider, so waiting is worse than
 *  failing. */
const WEBULL_TIMEOUT_MS = 5000;

/** Pure: `YYYY-MM-DDTHH:MM:SSZ` — seconds precision, no milliseconds. This is
 *  the ISO-8601 format Webull's signing spec requires for `x-timestamp`. */
export function isoTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Pure: Python's `urllib.parse.quote(s, safe='')`. `encodeURIComponent`
 *  leaves `!'()*` unescaped, so those are percent-encoded by hand to match. */
export function quoteAll(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Pure: the exact string Webull signs — the request path, then every
 *  signing param (headers lower-cased, plus `host`, plus any query params)
 *  sorted by codepoint, then (when a body is present) a trailing
 *  uppercase-hex SHA-256 of the compact-JSON body — all percent-encoded as
 *  one blob. */
export function buildStringToSign(path: string, signParams: Record<string, string>, bodyHash?: string): string {
  const sorted = Object.entries(signParams)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const withBody = bodyHash ? `${path}&${sorted}&${bodyHash}` : `${path}&${sorted}`;
  return quoteAll(withBody);
}

/** Pure: base64 HMAC-SHA256 keyed by `app_secret + "&"` (a literal trailing
 *  ampersand), not the raw secret — Webull's OpenAPI signing spec. Base64,
 *  not hex. */
export function signString(stringToSign: string, appSecret: string): string {
  return createHmac("sha256", `${appSecret}&`).update(stringToSign).digest("base64");
}

export type WebullAuthErrorReason = "clock-skew" | "bad-key";

export class WebullAuthError extends Error {
  constructor(message: string, public readonly reason: WebullAuthErrorReason) {
    super(message);
    this.name = "WebullAuthError";
  }
}

/** Pure: classifies a 401 response body as clock-skew (stale timestamp/nonce
 *  — safe to retry once with a fresh one) vs. a bad/revoked key (a real auth
 *  error — alert, don't retry). */
export function classifyAuthError(body: { code?: string; msg?: string }): WebullAuthErrorReason {
  const text = `${body.code ?? ""} ${body.msg ?? ""}`.toLowerCase();
  if (/expired|timestamp|clock|nonce/.test(text)) return "clock-skew";
  return "bad-key";
}

export interface SignedFetchOptions {
  baseUrl: string;
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: unknown;
  /** Overrides the app key/secret pair (defaults to WEBULL_APP_KEY/SECRET —
   *  the production pair — so existing callers keep working unchanged). Pass
   *  these explicitly to sign against a different environment, e.g. sandbox's
   *  WEBULL_PAPER_APP_KEY/SECRET. */
  appKey?: string;
  appSecret?: string;
  /** Session token from POST /openapi/auth/token/create (+ /check), required
   *  by environments/apps with token_check_enabled — see
   *  scripts/webull-account-list.mts. Omit where it isn't required (verified
   *  true for the shared sandbox test credentials). */
  accessToken?: string;
}

async function doSignedFetch(path: string, opts: SignedFetchOptions, retried: boolean): Promise<Response> {
  const appKey = opts.appKey ?? process.env.WEBULL_APP_KEY;
  const appSecret = opts.appSecret ?? process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");

  const method = opts.method ?? "GET";
  const url = new URL(path, opts.baseUrl);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const bodyHash = bodyStr !== undefined ? createHash("sha256").update(bodyStr).digest("hex").toUpperCase() : undefined;

  // Every call sets its timestamp/nonce from call time (never cached) —
  // Webull's signing rejects requests outside its clock-skew window, so a
  // stale cached timestamp would fail every subsequent call.
  const headers: Record<string, string> = {
    "x-app-key": appKey,
    "x-timestamp": isoTimestamp(new Date()),
    "x-signature-version": "1.0",
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": randomUUID(),
  };
  // `host` plus every signing header plus any query params form the signed
  // set — never a second, independently-maintained list. Do NOT put a `host`
  // header on the actual outgoing request; it's signed but not sent as one.
  const signParams: Record<string, string> = { ...headers, host: url.host, ...(opts.params ?? {}) };
  headers["x-signature"] = signString(buildStringToSign(path, signParams, bodyHash), appSecret);
  if (opts.accessToken) headers["x-access-token"] = opts.accessToken;
  if (bodyStr !== undefined) headers["content-type"] = "application/json";

  // Bounded so an unreachable Webull host fails fast and callers can fall back to
  // another provider. Without this, an unroutable host burns Node's full TCP
  // connect timeout (~10s) on every request and the price chart just hangs.
  const res = await fetch(url.toString(), {
    method,
    headers,
    signal: AbortSignal.timeout(WEBULL_TIMEOUT_MS),
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });

  if (res.status === 401) {
    const errBody = await res.json().catch(() => ({}));
    const reason = classifyAuthError(errBody as { code?: string; msg?: string });
    if (reason === "clock-skew" && !retried) {
      return doSignedFetch(path, opts, true); // resync: fresh timestamp+nonce, retry exactly once
    }
    throw new WebullAuthError(`webull auth failed (${reason}): ${JSON.stringify(errBody)}`, reason);
  }
  return res;
}

/** Signed GET/POST against a Webull OpenAPI host. A clock-skew-classified 401
 *  is retried once with a resynced timestamp; a second failure (or a
 *  bad-key 401) throws WebullAuthError so callers/alerts can tell the two
 *  apart ("your runner's clock is off" vs. "your key is wrong"). */
export async function signedFetch(path: string, opts: SignedFetchOptions): Promise<Response> {
  return doSignedFetch(path, opts, false);
}
