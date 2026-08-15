// Webull PaperTrade order client — places/checks risk-free bracket orders.
// Isolated on top of the shared auth.ts so a later live-trading phase can
// reuse the request-building logic behind a different base URL/account
// without touching this module.
import { signedFetch } from "./auth";
import { getTickerId } from "./symbols";

/** Pure: floors `qty` to a whole share (PaperTrade bracket orders reject
 *  fractional shares, unlike NEXMIND's own risk-based sizing). Returns null
 *  when the floored quantity is < 1 — the caller must skip, not send. */
export function floorQty(qty: number): number | null {
  const floored = Math.floor(qty);
  return floored < 1 ? null : floored;
}

/** Pure (given `now`): true during 09:30-16:00 ET on a weekday. Bracket
 *  orders are typically rejected outside regular trading hours. */
export function isRegularTradingHours(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface BracketOrderInput {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  sl: number;
  tp: number;
  accountId: string;
}

/** Pure: constructs the bracket-order request body. Parent is always
 *  MARKET (not LIMIT) — a LIMIT parent could gap-open unfilled and desync
 *  from the Trade NEXMIND's simulation already recorded as entered; the
 *  point of shadow execution is to observe real fills/slippage. TIF is
 *  always GTC — NEXMIND's swing trades are multi-day, and a DAY order's
 *  unfilled entry or armed SL/TP would be auto-cancelled at the close.
 *  Throws if qty floors under 1 — callers must check floorQty() first. */
export function buildBracketOrderPayload(input: BracketOrderInput & { tickerId: number }) {
  const quantity = floorQty(input.qty);
  if (quantity == null) throw new Error("webull: qty < 1 share, cannot build order payload");
  return {
    accountId: input.accountId,
    tickerId: input.tickerId,
    action: input.side === "long" ? "BUY" : "SELL",
    orderType: "MARKET",
    quantity,
    timeInForce: "GTC",
    bracket: {
      stopLoss: { orderType: "STOP", stopPrice: input.sl },
      takeProfit: { orderType: "LIMIT", limitPrice: input.tp },
    },
  };
}

export type PlaceShadowOrderResult =
  | { kind: "placed"; parentOrderId: string; slOrderId: string | null; tpOrderId: string | null }
  | { kind: "skipped"; reason: "outside-rth" | "qty-under-1" }
  | { kind: "error"; message: string };

/** Places a shadow bracket order against Webull's PaperTrade account. Never
 *  throws — always resolves to a PlaceShadowOrderResult so callers can stay
 *  fully fail-open. `opts.now` is injectable for the RTH check (defaults to
 *  the real current time). */
export async function placeWebullBracketOrder(
  input: BracketOrderInput,
  opts: { now?: Date } = {},
): Promise<PlaceShadowOrderResult> {
  const now = opts.now ?? new Date();
  if (!isRegularTradingHours(now)) return { kind: "skipped", reason: "outside-rth" };
  if (floorQty(input.qty) == null) return { kind: "skipped", reason: "qty-under-1" };

  try {
    const tickerId = await getTickerId(input.symbol);
    const payload = buildBracketOrderPayload({ ...input, tickerId });
    const res = await signedFetch("/api/paper/order/place", {
      baseUrl: process.env.WEBULL_PAPER_BASE_URL || "https://act.webulltrade.com",
      method: "POST",
      body: payload,
    });
    if (!res.ok) return { kind: "error", message: `webull paper order upstream ${res.status}` };
    const json = (await res.json()) as { orderId?: string; slOrderId?: string; tpOrderId?: string };
    if (!json.orderId) return { kind: "error", message: "webull paper order: missing orderId in response" };
    return { kind: "placed", parentOrderId: json.orderId, slOrderId: json.slOrderId ?? null, tpOrderId: json.tpOrderId ?? null };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface WebullBracketOrderIds {
  parentOrderId: string;
  slOrderId: string | null;
  tpOrderId: string | null;
}

interface WebullExecution { qty: number; price: number }
interface ChildOrderStatus { status: string; executions: WebullExecution[]; kind: "TAKE_PROFIT" | "STOP_LOSS" }

export interface ExitDerivation {
  exitPrice: number | null;
  exitFilledQty: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | null;
  isClosed: boolean;
}

const CHILD_TERMINAL_STATES = new Set(["FILLED", "CANCELLED"]);

/** Pure: derives exit price/qty/reason from whichever child order (SL or TP)
 *  actually triggered. exitPrice is the volume-weighted average fill price
 *  across that child's (possibly multiple, on thin liquidity) executions —
 *  not just the first or last fill. isClosed only becomes true once the
 *  filled quantity reaches entryFilledQty, or the child order itself
 *  reports a terminal state — never inferred from "a fill was seen." */
export function deriveExitFromChildOrder(child: ChildOrderStatus | null, entryFilledQty: number): ExitDerivation {
  if (!child || child.executions.length === 0) {
    return { exitPrice: null, exitFilledQty: 0, exitReason: null, isClosed: false };
  }
  const totalQty = child.executions.reduce((s, e) => s + e.qty, 0);
  const vwap = child.executions.reduce((s, e) => s + e.qty * e.price, 0) / totalQty;
  const isClosed = totalQty >= entryFilledQty || CHILD_TERMINAL_STATES.has(child.status);
  return { exitPrice: vwap, exitFilledQty: totalQty, exitReason: child.kind, isClosed };
}

export interface WebullBracketStatus {
  entryFillPrice: number | null;
  entryFilledQty: number | null;
  entryFilledAt: Date | null;
  exitPrice: number | null;
  exitFilledQty: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | null;
  isClosed: boolean;
}

async function fetchChildOrder(orderId: string, kind: "TAKE_PROFIT" | "STOP_LOSS", baseUrl: string): Promise<ChildOrderStatus> {
  const res = await signedFetch(`/api/paper/order/${orderId}`, { baseUrl, method: "GET" });
  if (!res.ok) throw new Error(`webull child order-status upstream ${res.status}`);
  const json = (await res.json()) as { status?: string; executions?: WebullExecution[] };
  return { status: json.status ?? "UNKNOWN", executions: json.executions ?? [], kind };
}

/** Checks the parent AND both child orders — a parent stuck at FILLED
 *  forever would hide the real outcome, since exit price/time/reason live on
 *  whichever child order fired (the other is auto-CANCELLED by the OCO
 *  pair). */
export async function getWebullOrderStatus(ids: WebullBracketOrderIds): Promise<WebullBracketStatus> {
  const baseUrl = process.env.WEBULL_PAPER_BASE_URL || "https://act.webulltrade.com";
  const parentRes = await signedFetch(`/api/paper/order/${ids.parentOrderId}`, { baseUrl, method: "GET" });
  if (!parentRes.ok) throw new Error(`webull order-status upstream ${parentRes.status}`);
  const parent = (await parentRes.json()) as { filledPrice?: number; filledQty?: number; filledAt?: string };
  const entryFilledQty = parent.filledQty ?? 0;

  const slChild = ids.slOrderId ? await fetchChildOrder(ids.slOrderId, "STOP_LOSS", baseUrl) : null;
  const tpChild = ids.tpOrderId ? await fetchChildOrder(ids.tpOrderId, "TAKE_PROFIT", baseUrl) : null;
  const triggered = (slChild && slChild.executions.length > 0) ? slChild : (tpChild && tpChild.executions.length > 0) ? tpChild : null;
  const exit = deriveExitFromChildOrder(triggered, entryFilledQty);

  return {
    entryFillPrice: parent.filledPrice ?? null,
    entryFilledQty: parent.filledQty ?? null,
    entryFilledAt: parent.filledAt ? new Date(parent.filledAt) : null,
    exitPrice: exit.exitPrice,
    exitFilledQty: exit.exitFilledQty,
    exitReason: exit.exitReason,
    isClosed: exit.isClosed,
  };
}
