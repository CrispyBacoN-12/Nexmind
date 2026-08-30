// Seeds the one Webull production access token the desk needs a human for.
//
// Run it, tap approve in the Webull app within ~6 minutes, and it writes the
// token to the Setting table. From then on src/lib/webull/webullToken.ts
// refreshes it unattended (15-day life, refresh needs no second approval), so
// this should be needed once — and again only if a refresh fails for a full
// week, which the War Room banner warns about well before it happens.
//
// It signs through src/lib/webull/auth.ts on purpose, the same path the
// unattended refresh uses: if seeding works, the refresh signing works too.
//
// Usage: node --env-file=.env --import tsx scripts/webull-seed-token.mts
//
// The token is a credential: it is never printed, only stored.
import { signedFetch } from "@/lib/webull/auth";
import { parseTokenResponse } from "@/lib/webull/tokenProvider";
import { loadWebullToken, storeWebullToken, productionCreds } from "@/lib/webull/webullToken";

const CHECK_INTERVAL_MS = 5_000;
// Webull's approval window measured ~6 minutes; allow a little past it so a
// slow tap still lands rather than failing at the boundary.
const CHECK_TIMEOUT_MS = 8 * 60_000;

interface TokenState { token: string; status: string; expires_at?: number }

async function post(path: string, body: unknown, accessToken?: string) {
  const { baseUrl, appKey, appSecret } = productionCreds();
  const res = await signedFetch(path, { baseUrl, method: "POST", appKey, appSecret, body, accessToken });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} upstream ${res.status}: ${JSON.stringify(json)}`);
  return json as TokenState;
}

async function main() {
  const existing = await loadWebullToken();
  if (existing) {
    const daysLeft = (existing.expiresAt - Date.now()) / 86_400_000;
    console.log(`a token is already stored, ${daysLeft.toFixed(1)} days left — seeding will replace it`);
  }

  const created = await post("/openapi/auth/token/create", {});
  console.log(`token/create -> ${created.status}`);

  let state = created;
  if (state.status === "PENDING") {
    console.log("approve the request in the Webull app now — polling token/check every 5s");
    const deadline = Date.now() + CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
      state = await post("/openapi/auth/token/check", { token: created.token });
      process.stdout.write(`.${state.status === "NORMAL" ? "\n" : ""}`);
      if (state.status !== "PENDING") break;
    }
  }

  const rec = parseTokenResponse(state);
  if (!rec) throw new Error(`token did not reach NORMAL (last status: ${state.status}) — rerun and approve in the app`);

  await storeWebullToken(rec);
  console.log(`stored. expires ${new Date(rec.expiresAt).toISOString()} (${((rec.expiresAt - Date.now()) / 86_400_000).toFixed(2)} days)`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); },
);
