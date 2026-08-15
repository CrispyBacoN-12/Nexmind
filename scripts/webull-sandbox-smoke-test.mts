// Manual smoke test against the real Webull sandbox — NOT part of the
// automated test suite (no automated test hits the live/sandbox Webull
// network per the design doc's Testing section). Run by hand once
// WEBULL_APP_KEY/WEBULL_APP_SECRET/WEBULL_PAPER_ACCOUNT_ID are set, to
// sanity-check signing + a real candle fetch + a real (paper, risk-free)
// bracket order before relying on any of this in production.
// Usage: node --import tsx scripts/webull-sandbox-smoke-test.mts [SYMBOL]
import { fetchWebullCandles } from "../src/lib/webull";
import { getTickerId } from "../src/lib/webull/symbols";
import { placeWebullBracketOrder, getWebullOrderStatus } from "../src/lib/webull/paperTrade";

async function main() {
  const symbol = process.argv[2] ?? "AAPL";

  console.log(`1) resolving tickerId for ${symbol}...`);
  const tickerId = await getTickerId(symbol);
  console.log(`   tickerId=${tickerId}`);

  console.log(`2) fetching candles for ${symbol}...`);
  const candles = await fetchWebullCandles(symbol, "1mo", "1d");
  console.log(`   ${candles.candles.length} candles, last close=${candles.price}`);

  console.log(`3) placing a 1-share MARKET bracket order for ${symbol} (paper account, risk-free)...`);
  const entry = candles.price ?? 0;
  const result = await placeWebullBracketOrder({
    symbol, side: "long", qty: 1, entry, sl: entry * 0.95, tp: entry * 1.05,
    accountId: process.env.WEBULL_PAPER_ACCOUNT_ID ?? "",
  });
  console.log("   result:", result);

  if (result.kind === "placed") {
    console.log("4) checking order status immediately (parent likely still pending)...");
    const status = await getWebullOrderStatus({ parentOrderId: result.parentOrderId, slOrderId: result.slOrderId, tpOrderId: result.tpOrderId });
    console.log("   status:", status);
  }
}

main().catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; });
