// Sweeps every non-terminal WebullShadowOrder, fetches its live status from
// Webull, and applies the result through the monotonicity-guarded update
// layer. Called by both the dedicated lightweight cron and the swing-scan
// cron (as a backstop) — safe under overlap since applyShadowOrderUpdate
// rejects any write that would move a row's status backward out of terminal.
import { prisma } from "@/lib/db";
import { getWebullOrderStatus } from "./paperTrade";
import { applyShadowOrderUpdate } from "./shadowOrderStore";

export interface PollSummary { checked: number; updated: number; errors: number }

export async function pollOpenShadowOrders(): Promise<PollSummary> {
  const rows = await prisma.webullShadowOrder.findMany({
    where: { status: { in: ["pending", "open", "filled"] } },
  });

  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const s = await getWebullOrderStatus({ parentOrderId: row.parentOrderId, slOrderId: row.slOrderId, tpOrderId: row.tpOrderId });
      const nextStatus = s.isClosed ? "closed" : s.entryFilledQty != null ? "filled" : "open";
      const applied = await applyShadowOrderUpdate(row.tradeId, {
        status: nextStatus,
        entryFillPrice: s.entryFillPrice,
        entryFilledQty: s.entryFilledQty,
        entryFilledAt: s.entryFilledAt,
        exitPrice: s.exitPrice,
        exitReason: s.exitReason,
        exitFilledQty: s.exitFilledQty,
        closedAt: s.isClosed ? new Date() : null,
      });
      if (applied) updated++;
    } catch (e) {
      errors++;
      await prisma.webullShadowOrder
        .update({ where: { id: row.id }, data: { lastError: e instanceof Error ? e.message : String(e) } })
        .catch(() => { /* best-effort — don't let a logging failure mask the original error */ });
    }
  }
  return { checked: rows.length, updated, errors };
}
