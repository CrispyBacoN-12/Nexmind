import { parseGoldHealthResponse } from "./types";

export interface BridgeHealth {
  reachable: boolean;
  connected?: boolean;
  error?: string;
}

export async function checkBridgeHealth(timeoutMs = 2000): Promise<BridgeHealth> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  const baseUrl = process.env.MT5_BRIDGE_URL ?? "http://127.0.0.1:8787";
  if (!secret) {
    return { reachable: false, error: "mt5: missing MT5_BRIDGE_SECRET" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { "X-Bridge-Secret": secret },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { reachable: false, error: `bridge health check: upstream ${res.status}` };
    }
    const body = parseGoldHealthResponse(await res.json());
    return { reachable: true, connected: body.connected };
  } catch (err) {
    return { reachable: false, error: `bridge unreachable: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
