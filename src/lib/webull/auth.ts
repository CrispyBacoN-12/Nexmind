// Shared HMAC-SHA256 request signing for Webull's OpenAPI (data + PaperTrade).
// One module so webull.ts and webull/paperTrade.ts never build two
// independently-maintained signature implementations that could drift apart.
import { createHmac, createHash, randomUUID } from "node:crypto";

export interface SignableRequest {
  host: string;
  params: Record<string, string>;
  body?: string;
  nonce: string;
}

/** Pure: builds the exact string Webull hashes — every query param plus
 *  `host` and `x-signature-nonce`, sorted alphabetically, from one shared
 *  source list (never two independently-maintained lists that could drift
 *  apart). A POST body is appended as `toUpper(SHA256(body))`; a bodyless GET
 *  omits that segment entirely rather than hashing an empty string. */
export function buildSignatureString(req: SignableRequest): string {
  const entries: [string, string][] = [
    ...Object.entries(req.params),
    ["host", req.host],
    ["x-signature-nonce", req.nonce],
  ];
  entries.sort(([a], [b]) => a.localeCompare(b));
  const sorted = entries.map(([k, v]) => `${k}=${v}`).join("&");
  if (req.body) {
    const bodyHash = createHash("sha256").update(req.body).digest("hex").toUpperCase();
    return `${sorted}&${bodyHash}`;
  }
  return sorted;
}

/** Pure: HMAC-SHA256 hex signature. The key is `app_secret + "&"` (a literal
 *  trailing ampersand), not the raw secret — Webull's OpenAPI signing spec. */
export function signString(signatureString: string, appSecret: string): string {
  return createHmac("sha256", `${appSecret}&`).update(signatureString).digest("hex");
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
}

async function doSignedFetch(path: string, opts: SignedFetchOptions, retried: boolean): Promise<Response> {
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");

  const method = opts.method ?? "GET";
  const url = new URL(path, opts.baseUrl);
  const host = url.host;
  const bodyStr = opts.body != null ? JSON.stringify(opts.body) : undefined;
  const nonce = randomUUID();
  // Every call sets its timestamp from call time (never cached) — Webull's
  // signing is timestamp-based and rejects requests outside its clock-skew
  // window, so a stale cached timestamp would fail every subsequent call.
  const params: Record<string, string> = { ...(opts.params ?? {}), appKey, timestamp: String(Date.now()) };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const signatureString = buildSignatureString({ host, params, body: bodyStr, nonce });
  const signature = signString(signatureString, appSecret);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "x-signature-nonce": nonce,
      "x-app-key": appKey,
      "x-signature": signature,
      ...(bodyStr ? { "content-type": "application/json" } : {}),
    },
    ...(bodyStr ? { body: bodyStr } : {}),
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
