// Every write to WebullShadowOrder goes through this module so an
// out-of-order cron response (the lightweight poll and the swing-scan
// backstop can overlap) can never revert a row out of a terminal status
// once reached, silently losing recorded exit data.
import { prisma } from "@/lib/db";

const TERMINAL_STATUSES = new Set(["closed", "cancelled", "rejected"]);

/** Pure: true when moving from `current` to `next` is allowed. Once a row is
 *  terminal, only staying at the SAME terminal status is allowed (so a
 *  later, more complete field correction can still be written) — moving to
 *  any different status, terminal or not, is rejected. */
export function canTransitionShadowOrderStatus(current: string, next: string): boolean {
  if (!TERMINAL_STATUSES.has(current)) return true;
  return current === next;
}

export interface ShadowOrderStatusUpdate {
  status: string;
  entryFillPrice?: number | null;
  entryFilledQty?: number | null;
  entryFilledAt?: Date | null;
  exitPrice?: number | null;
  exitReason?: string | null;
  exitFilledQty?: number | null;
  closedAt?: Date | null;
  lastError?: string | null;
}

/** Applies `update` to the WebullShadowOrder for `tradeId`, rejecting (no-op)
 *  any write that would move `status` away from a terminal value. Returns
 *  true if the write was applied, false if it was rejected by the guard or
 *  no row exists yet. */
export async function applyShadowOrderUpdate(tradeId: number, update: ShadowOrderStatusUpdate): Promise<boolean> {
  const row = await prisma.webullShadowOrder.findUnique({ where: { tradeId }, select: { status: true } });
  if (!row) return false;
  if (!canTransitionShadowOrderStatus(row.status, update.status)) return false;
  await prisma.webullShadowOrder.update({ where: { tradeId }, data: update });
  return true;
}

/** Creates the WebullShadowOrder row right after a successful placement. */
export async function createShadowOrder(
  tradeId: number,
  parentOrderId: string,
  slOrderId: string | null,
  tpOrderId: string | null,
): Promise<void> {
  await prisma.webullShadowOrder.create({
    data: { tradeId, parentOrderId, slOrderId, tpOrderId, status: "open" },
  });
}
