// The trade journal and NAV log: the owner's hand-placed trades and daily
// account value. All validation lives in src/lib/portfolio/journalInput.ts;
// this route only reads/writes rows and fetches the two facts recorded at
// entry (sector, worst gap-through), both fail-soft.

import { gapRisk } from "@/lib/advisor/gapRisk";
import { prisma } from "@/lib/db";
import { fetchFundamentals } from "@/lib/market/fundamentals";
import { fetchCandles } from "@/lib/marketData";
import { parseCloseTrade, parseNavEntry, parseOpenTrade } from "@/lib/portfolio/journalInput";
import { resolveGicsSector } from "@/lib/portfolio/sectorMap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

async function snapshot() {
  const [open, closed, nav, overrides] = await Promise.all([
    prisma.journalTrade.findMany({ where: { exitDate: null }, orderBy: { entryDate: "asc" } }),
    prisma.journalTrade.findMany({ where: { NOT: { exitDate: null } }, orderBy: { exitDate: "desc" }, take: 50 }),
    prisma.navSnapshot.findMany({ orderBy: { date: "desc" }, take: 400 }),
    prisma.gateOverride.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return Response.json({ ok: true, open, closed, nav: nav.reverse(), overrides });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  switch (body.action) {
    case "open": {
      const p = parseOpenTrade(body);
      if (!p.ok) return bad(p.error);
      const t = p.value;
      if (await prisma.journalTrade.findFirst({ where: { ticker: t.ticker, exitDate: null } })) {
        return bad(`${t.ticker} is already open in the journal. Close it first.`);
      }
      // Both lookups fail soft: an unknown sector is stored as "Other" and an
      // unmeasured gap as null, which the gates then report as unknown.
      const [fund, candles] = await Promise.all([
        fetchFundamentals(t.ticker).catch(() => null),
        fetchCandles(t.ticker, "2y", "1d").then((r) => r.candles).catch(() => null),
      ]);
      const gap = candles && candles.length > 0 ? gapRisk(candles) : null;
      await prisma.journalTrade.create({
        data: { ...t, sector: resolveGicsSector(t.ticker, fund?.industry), worstLossR: gap?.worstLossR ?? null },
      });
      return snapshot();
    }

    case "close": {
      const id = Number(body.id);
      const row = Number.isInteger(id) ? await prisma.journalTrade.findUnique({ where: { id } }) : null;
      if (!row) return bad("That trade does not exist.", 404);
      if (row.exitDate != null) return bad(`${row.ticker} is already closed.`);
      const p = parseCloseTrade(body, row.entryDate);
      if (!p.ok) return bad(p.error);
      await prisma.journalTrade.update({ where: { id }, data: p.value });
      return snapshot();
    }

    case "delete": {
      // For typos only. Overrides that pointed at it keep their text (SetNull).
      const id = Number(body.id);
      if (!Number.isInteger(id)) return bad("That trade does not exist.", 404);
      await prisma.journalTrade.delete({ where: { id } }).catch(() => null);
      return snapshot();
    }

    case "nav": {
      const p = parseNavEntry(body);
      if (!p.ok) return bad(p.error);
      const { date, ...rest } = p.value;
      await prisma.navSnapshot.upsert({ where: { date }, update: rest, create: p.value });
      return snapshot();
    }

    default:
      return bad('Unknown action — expected "open", "close", "delete" or "nav".');
  }
}
