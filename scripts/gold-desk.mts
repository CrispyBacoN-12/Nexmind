import "dotenv/config";
import { checkBridgeHealth } from "../src/lib/gold/health";
import { reconcilePositions } from "../src/lib/gold/broker";

async function main(): Promise<void> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (!secret) {
    console.error("gold-desk: MT5_BRIDGE_SECRET is not set — refusing to start");
    process.exit(1);
  }
  if (process.env.MT5_BRIDGE_ALLOW_REAL === "1") {
    console.error(
      "gold-desk: MT5_BRIDGE_ALLOW_REAL=1 — this desk only runs against demo/contest accounts, refusing to start",
    );
    process.exit(1);
  }

  console.log("gold-desk: checking bridge health...");
  const health = await checkBridgeHealth();
  if (!health.reachable) {
    console.error(`gold-desk: bridge unreachable — ${health.error}`);
    process.exit(1);
  }
  if (!health.connected) {
    console.error("gold-desk: bridge is up but not connected to a terminal");
    process.exit(1);
  }
  console.log("gold-desk: bridge healthy and connected.");

  console.log("gold-desk: reconciling open positions...");
  const positions = await reconcilePositions();
  console.log(`gold-desk: ${positions.length} open position(s) on boot.`);
  for (const p of positions) {
    console.log(`  ${p.symbol} ${p.side} ${p.volume} @ ${p.priceOpen} (magic ${p.magic})`);
  }

  console.log("gold-desk: ready. No mechanism is wired to this desk yet — read-only pipeline only.");
}

main().catch((err) => {
  console.error("gold-desk: fatal error", err);
  process.exit(1);
});
