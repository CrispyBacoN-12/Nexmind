import "dotenv/config";
import { reconcilePositions, placeOrder, closePosition } from "../src/lib/gold/broker";
import { magicForTrade } from "../src/lib/mt5";

const SYMBOL = process.env.GOLD_SYMBOL ?? "XAUUSD";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "positions") {
    const positions = await reconcilePositions(SYMBOL);
    if (positions.length === 0) {
      console.log("no open positions");
      return;
    }
    for (const p of positions) {
      console.log(`${p.ticket} ${p.symbol} ${p.side} ${p.volume} @ ${p.priceOpen} magic=${p.magic} profit=${p.profit}`);
    }
    return;
  }

  if (command === "place") {
    const [side, volumeRaw, label] = args;
    if (side !== "buy" && side !== "sell") {
      console.error("usage: place <buy|sell> <volume> <label>");
      process.exit(1);
    }
    const volume = Number(volumeRaw);
    if (!Number.isFinite(volume) || volume <= 0) {
      console.error("volume must be a positive number");
      process.exit(1);
    }
    if (!label) {
      console.error("a label is required — it derives the idempotency magic");
      process.exit(1);
    }
    const magic = magicForTrade(label);
    const outcome = await placeOrder({ symbol: SYMBOL, side, volume, magic });
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (command === "close") {
    const [magicRaw] = args;
    const magic = Number(magicRaw);
    if (!Number.isFinite(magic)) {
      console.error("usage: close <magic>");
      process.exit(1);
    }
    const result = await closePosition({ magic });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error("usage: gold-manual-order-test.mts <positions|place|close> [args]");
  process.exit(1);
}

main().catch((err) => {
  console.error("gold-manual-order-test: fatal error", err);
  process.exit(1);
});
