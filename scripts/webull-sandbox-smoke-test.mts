// Manual smoke test against the real Webull sandbox — NOT part of the
// automated test suite (no automated test hits the live/sandbox Webull
// network per the design doc's Testing section). Run by hand to sanity-check
// signing + a real candle fetch before relying on Webull as a data provider.
//
// Data-only: Webull's trading endpoints (/openapi/trade/*) are not served by
// the sandbox host at all (every path 404s at the gateway there) and on
// production they require the x-access-token exchange, which needs in-app
// approval per session. The shadow paper-trade path that used to live here
// was removed for that reason — see webull.ts.
// Usage: node --import tsx scripts/webull-sandbox-smoke-test.mts [SYMBOL]
import "dotenv/config";
import { fetchWebullCandles } from "../src/lib/webull";

async function main() {
  const symbol = process.argv[2] ?? "AAPL";

  console.log(`fetching daily candles for ${symbol}...`);
  const daily = await fetchWebullCandles(symbol, "1mo", "1d");
  const last = daily.candles.at(-1);
  console.log(`   ${daily.candles.length} daily bars, last=${last ? new Date(last.t * 1000).toISOString().slice(0, 10) : "?"} close=${daily.price}`);

  console.log(`fetching hourly candles for ${symbol}...`);
  const hourly = await fetchWebullCandles(symbol, "5d", "60m");
  console.log(`   ${hourly.candles.length} hourly bars, last close=${hourly.price}`);
}

main().catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; });
