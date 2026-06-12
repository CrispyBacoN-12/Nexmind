import { NextResponse } from "next/server";
import { analyzeLongTerm } from "@/lib/invest/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { symbol?: string };
  const symbol = (body.symbol ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    return NextResponse.json(await analyzeLongTerm(symbol));
  } catch (e) {
    const msg = String(e);
    const hint = /not found|404|No data/i.test(msg)
      ? `Symbol not found — Thai stocks need a .BK suffix (e.g. PTT.BK).`
      : msg.slice(0, 200);
    return NextResponse.json({ error: hint }, { status: 422 });
  }
}
