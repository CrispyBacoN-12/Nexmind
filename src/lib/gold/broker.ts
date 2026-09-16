import {
  fetchMt5Account,
  fetchMt5Positions,
  sendMt5Order,
  closeMt5Position,
  isDemoAccount,
  type Mt5OrderRequest,
  type Mt5OrderResult,
  type Mt5Position,
  type Mt5CloseResult,
} from "@/lib/mt5";
import { classifyRetcode, type RetcodeBucket } from "./retcodes";

export class GoldOrderUnresolvedError extends Error {
  constructor(public readonly magic: number) {
    super(`gold: order with magic ${magic} timed out and could not be resolved against open positions`);
    this.name = "GoldOrderUnresolvedError";
  }
}

export async function assertDemoAccount(): Promise<void> {
  const account = await fetchMt5Account();
  if (!isDemoAccount(account)) {
    throw new Error(`gold: refusing to trade a non-demo account (tradeMode=${account.tradeMode})`);
  }
}

export async function reconcilePositions(symbol?: string): Promise<Mt5Position[]> {
  return fetchMt5Positions(symbol);
}

export type PlaceOrderOutcome =
  | { status: "sent"; result: Mt5OrderResult }
  | { status: "not-sent"; reason: string; bucket?: RetcodeBucket };

export interface PlaceOrderOptions {
  raceTimeoutMs?: number;
  maxResolutionAttempts?: number;
  resolutionDelayMs?: number;
}

const ORDER_REJECTED_RE = /order rejected: (\d+) /;

export async function placeOrder(
  req: Mt5OrderRequest,
  options: PlaceOrderOptions = {},
): Promise<PlaceOrderOutcome> {
  await assertDemoAccount();

  const { raceTimeoutMs = 15_000, maxResolutionAttempts = 5, resolutionDelayMs = 1000 } = options;

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), raceTimeoutMs);
  });
  const orderPromise = sendMt5Order(req).then(
    (result): { outcome: "result"; result: Mt5OrderResult } => ({ outcome: "result", result }),
    (error: unknown): { outcome: "error"; error: unknown } => ({ outcome: "error", error }),
  );

  const race = await Promise.race([orderPromise, timeoutPromise]);

  if (race === "timeout") {
    return resolveInFlight(req.magic, maxResolutionAttempts, resolutionDelayMs);
  }

  if (race.outcome === "result") {
    return { status: "sent", result: race.result };
  }

  const message = race.error instanceof Error ? race.error.message : String(race.error);
  const match = ORDER_REJECTED_RE.exec(message);
  if (match) {
    return { status: "not-sent", reason: message, bucket: classifyRetcode(Number(match[1])) };
  }
  return { status: "not-sent", reason: message };
}

async function resolveInFlight(
  magic: number,
  maxAttempts: number,
  delayMs: number,
): Promise<PlaceOrderOutcome> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const positions = await fetchMt5Positions();
      const match = positions.find((p) => p.magic === magic);
      if (match) {
        return {
          status: "sent",
          result: { duplicate: true, position: match, note: "resolved via boot reconciliation after timeout" },
        };
      }
    } catch {
      // fetchMt5Positions itself failed this attempt — retry rather than
      // collapsing to a guess about whether the order went through.
    }
  }
  throw new GoldOrderUnresolvedError(magic);
}

export async function closePosition(
  target: { ticket: number } | { magic: number },
  volume?: number,
): Promise<Mt5CloseResult> {
  await assertDemoAccount();
  return closeMt5Position(target, volume);
}
