// The owner's holdings (local file). LOCAL ONLY: on Vercel every method 404s
// before touching the file — the deployed site is public.

import { isDeployed } from "@/lib/portfolioRisk/localOnly";
import { deleteHolding, parseHoldingInput, readHoldings, upsertHolding } from "@/lib/portfolioRisk/store";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ ok: false, error: "not found" }, { status: 404 });
const fail = (e: unknown) => Response.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) }, { status: 500 });

export async function GET() {
  if (isDeployed()) return notFound();
  try {
    return Response.json({ ok: true, holdings: await readHoldings() });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  if (isDeployed()) return notFound();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseHoldingInput(body);
    if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
    return Response.json({ ok: true, holdings: await upsertHolding(parsed.value) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  if (isDeployed()) return notFound();
  try {
    const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
    if (!ticker) return Response.json({ ok: false, error: "ticker is required" }, { status: 400 });
    return Response.json({ ok: true, holdings: await deleteHolding(ticker) });
  } catch (e) {
    return fail(e);
  }
}
