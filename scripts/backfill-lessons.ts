// One-time (re-runnable) backfill: MEMO distills a lesson for every closed
// losing trade that doesn't have one yet. Lesson.tradeId is unique — a
// P2002 on create means this trade already has a lesson; skip it.
//
// Usage: npm run backfill-lessons

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateLesson, type LessonInput } from "../src/lib/trading/memo";

// Recovers the exit price from manage.ts's close note, e.g.
// "loss — exit 64000.0000 (price 63990.0000)".
const EXIT_RE = /exit (-?\d+(?:\.\d+)?)/;

function recoverExit(decisionLog: string): number | null {
  try {
    const log = JSON.parse(decisionLog) as { stage: string; note: string }[];
    const manageEntry = [...log].reverse().find((e) => e.stage === "manage");
    if (!manageEntry) return null;
    const m = manageEntry.note.match(EXIT_RE);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function main() {
  const trades = await prisma.trade.findMany({ where: { status: "closed", outcome: "loss" } });
  let created = 0;
  let skipped = 0;

  for (const trade of trades) {
    const close: LessonInput = {
      outcome: "loss",
      exit: recoverExit(trade.decisionLog),
      pnl: trade.pnl,
      rMultiple: trade.rMultiple,
    };

    try {
      const { text } = await generateLesson(trade, close);
      await prisma.lesson.create({ data: { tradeId: trade.id, text } });
      console.log(`${trade.symbol} (#${trade.id}) — ${text}`);
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  console.log(`\nDone. ${created} lesson(s) created, ${skipped} already had one.`);
}

main().finally(() => prisma.$disconnect());
