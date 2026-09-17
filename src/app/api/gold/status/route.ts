import { NextResponse } from "next/server";
import { checkBridgeHealth } from "@/lib/gold/health";
import { reconcilePositions } from "@/lib/gold/broker";

export async function GET() {
  const health = await checkBridgeHealth();
  if (!health.reachable || !health.connected) {
    return NextResponse.json({ health, positions: [] }, { status: 503 });
  }
  const positions = await reconcilePositions();
  return NextResponse.json({ health, positions });
}
