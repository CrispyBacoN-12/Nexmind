// One-shot helper: exchanges Webull's App Key/Secret for a session
// x-access-token (per webull-inc/webull-openapi-python-sdk's TokenManager —
// AK/SK alone signs requests but does NOT authorize them; every call needs
// an additional x-access-token from POST /openapi/auth/token/create, which
// may sit PENDING until approved in the Webull app before you can
// POST /openapi/auth/token/check it into NORMAL), then calls account-list
// and prints every account id so you can fill WEBULL_PAPER_ACCOUNT_ID in
// .env.local. The account id is not shown anywhere in the developer portal
// — the API is the only source.
//
// Deliberately self-contained: it does NOT use src/lib/webull/auth.ts. That
// module was written before we had access to the real API reference and
// signs requests differently from the official SDK (hex vs. base64 HMAC,
// epoch-ms `timestamp` query param vs. an ISO-8601 `x-timestamp` header, no
// URI prefix or percent-encoding in the signed string, and it doesn't know
// about the access-token exchange at all). The signing below mirrors
// webull-inc/webull-openapi-python-sdk's default_signature_composer +
// token_manager, so this script also doubles as the reference
// implementation for fixing auth.ts.
//
// Usage: node --env-file=.env --import tsx scripts/webull-account-list.mts [baseUrl]
//   default baseUrl: $WEBULL_BASE_URL, else the TH sandbox host
//   TH production: https://api.webull.co.th
//   TH sandbox:    https://th-api.uat.webullbroker.com
//   (other regions use different hostnames entirely — see
//   developer.webull.<region>/apis/docs/sdk/)
import { createHmac, createHash, randomUUID } from "node:crypto";

const TOKEN_CHECK_INTERVAL_MS = 5_000;
const TOKEN_CHECK_TIMEOUT_MS = 90_000; // SDK default is 300s; shortened so the script fails fast instead of hanging silently — rerun if you need more time to approve in-app.

/** Pure: `YYYY-MM-DDTHH:MM:SSZ` — the SDK's FORMAT_ISO_8601, seconds
 *  precision. Millisecond precision is NOT accepted here. */
export function isoTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Pure: Python `urllib.parse.quote(s, safe='')` — percent-encodes everything
 *  except unreserved chars. encodeURIComponent leaves `!'()*` alone, so those
 *  are encoded by hand. */
export function quoteAll(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Pure: the exact string Webull signs — the request URI, then every signing
 *  header (lower-cased) plus `host` sorted by codepoint, then (for a POST) a
 *  trailing uppercase-hex SHA-256 of the compact-JSON body, all
 *  percent-encoded as one blob. Sorting is codepoint order (`<`), not locale
 *  order. Mirrors default_signature_composer's _build_sign_string +
 *  _get_body_string. */
export function buildStringToSign(uri: string, signParams: Record<string, string>, bodyHash?: string): string {
  const sorted = Object.entries(signParams)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const withBody = bodyHash ? `${uri}&${sorted}&${bodyHash}` : `${uri}&${sorted}`;
  return quoteAll(withBody);
}

/** Pure: base64 HMAC-SHA256 keyed by `app_secret + "&"` (literal trailing
 *  ampersand). Note base64, not hex. */
export function signString(stringToSign: string, appSecret: string): string {
  return createHmac("sha256", `${appSecret}&`).update(stringToSign).digest("base64");
}

/** Pure: SDK's `common.json_dumps_compact` — no spaces after separators.
 *  JSON.stringify already omits them, so this just documents the match. */
function compactJson(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

async function signedRequest(
  baseUrl: string,
  path: string,
  opts: { method: "GET" | "POST"; appKey: string; appSecret: string; bodyParams?: Record<string, unknown>; accessToken?: string },
): Promise<{ status: number; json: unknown }> {
  const url = new URL(path, baseUrl);
  const headers: Record<string, string> = {
    "x-app-key": opts.appKey,
    "x-timestamp": isoTimestamp(new Date()),
    "x-signature-version": "1.0",
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": randomUUID(),
  };

  const body = opts.bodyParams !== undefined ? compactJson(opts.bodyParams) : undefined;
  const bodyHash = body !== undefined ? createHash("sha256").update(body).digest("hex").toUpperCase() : undefined;

  const signParams = { ...headers, host: url.host };
  headers["x-signature"] = signString(buildStringToSign(path, signParams, bodyHash), opts.appSecret);
  if (opts.accessToken) headers["x-access-token"] = opts.accessToken;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(url.toString(), { method: opts.method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

interface TokenState { token: string; expires: number; status: "PENDING" | "NORMAL" | "INVALID" | "EXPIRED" | string }

/** Exchanges AK/SK for an x-access-token. First call is create (body `{}` —
 *  no prior local token), which may come back already NORMAL or PENDING; a
 *  PENDING token is polled via check every 5s until NORMAL, INVALID/EXPIRED
 *  (throws), or our timeout (throws — rerun once you've approved in-app). */
async function getAccessToken(baseUrl: string, appKey: string, appSecret: string): Promise<string> {
  const created = await signedRequest(baseUrl, "/openapi/auth/token/create", { method: "POST", appKey, appSecret, bodyParams: {} });
  if (created.status !== 200) throw new Error(`token/create upstream ${created.status}: ${JSON.stringify(created.json)}`);
  let state = created.json as TokenState;
  console.log(`token/create -> status=${state.status}`);
  if (state.status === "NORMAL") return state.token;
  if (state.status === "INVALID" || state.status === "EXPIRED") throw new Error(`token/create returned ${state.status}: ${JSON.stringify(state)}`);

  console.log("token is PENDING — if Webull requires in-app approval, check your phone now. Polling /openapi/auth/token/check...");
  const deadline = Date.now() + TOKEN_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, TOKEN_CHECK_INTERVAL_MS));
    const checked = await signedRequest(baseUrl, "/openapi/auth/token/check", { method: "POST", appKey, appSecret, bodyParams: { token: state.token } });
    if (checked.status !== 200) throw new Error(`token/check upstream ${checked.status}: ${JSON.stringify(checked.json)}`);
    state = checked.json as TokenState;
    console.log(`token/check -> status=${state.status}`);
    if (state.status === "NORMAL") return state.token;
    if (state.status === "INVALID" || state.status === "EXPIRED") throw new Error(`token/check returned ${state.status}: ${JSON.stringify(state)}`);
  }
  throw new Error(`token never reached NORMAL within ${TOKEN_CHECK_TIMEOUT_MS / 1000}s (last status=${state.status}) — approve it in the Webull app, then rerun this script`);
}

async function main() {
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("missing WEBULL_APP_KEY / WEBULL_APP_SECRET (set them in .env, then re-run with --env-file=.env)");
  }
  const baseUrl = process.argv[2] ?? process.env.WEBULL_BASE_URL ?? "https://th-api.uat.webullbroker.com";
  console.log(`base: ${baseUrl}`);

  const accessToken = await getAccessToken(baseUrl, appKey, appSecret);
  console.log(`got x-access-token (len=${accessToken.length})`);

  const res = await signedRequest(baseUrl, "/openapi/account/list", { method: "GET", appKey, appSecret, accessToken });
  console.log(`account/list -> ${res.status}`);
  console.log(JSON.stringify(res.json, null, 2));

  if (res.status !== 200) { process.exitCode = 1; return; }
  const rows = Array.isArray(res.json) ? res.json : (res.json as { data?: unknown[] }).data;
  if (!Array.isArray(rows)) return;
  console.log("\n--- account ids ---");
  for (const row of rows as Record<string, unknown>[]) {
    const id = row.account_id ?? row.accountId;
    console.log(`WEBULL_PAPER_ACCOUNT_ID=${String(id)}   (${JSON.stringify(row)})`);
  }
}

main().catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; });
