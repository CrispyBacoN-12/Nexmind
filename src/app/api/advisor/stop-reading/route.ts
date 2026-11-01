// POST /api/advisor/stop-reading — the AI's short Thai reading of a chart stop.
//
// The body is server-produced data making a round trip through the browser: the
// card /api/advisor returned and the StopContext it returned beside it. A shape
// check is the proportionate defence, as in /api/advisor/critique. Nothing here
// is persisted, sized or traded on; the reading never changes a number.

import type { StopContext } from "@/lib/advisor/chartStop";
import type { AdvisorCard } from "@/lib/advisor/types";
import { readStop } from "@/lib/critic/stopReader";

export const dynamic = "force-dynamic";

/** One CLI call behind a 3-way gate; longer than callAgentCli's own 240s timeout, as in /api/advisor/critique. */
export const maxDuration = 300;

const bad = (error: string) => Response.json({ ok: false, error }, { status: 400 });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const card = body.card;
  if (card == null || typeof card !== "object" || Array.isArray(card)) return bad("body.card is required");
  const c = card as Record<string, unknown>;
  if (typeof c.ticker !== "string" || c.ticker.trim() === "") return bad("card.ticker is required");
  if (typeof c.entry !== "number" || !Number.isFinite(c.entry)) return bad("card.entry must be a number");
  if (typeof c.stop !== "number" || !Number.isFinite(c.stop)) return bad("card.stop must be a number");
  if (typeof c.stopSource !== "string") return bad("card.stopSource is required");

  // context may legitimately be null (no 5-minute bars): readStop then skips.
  const ctx = body.context;
  if (ctx != null && (typeof ctx !== "object" || Array.isArray(ctx))) return bad("body.context must be an object or null");

  const context = ctx == null ? null : (ctx as StopContext);
  // The shape gate is not full validation: a context missing `recent` throws in
  // the prompt builder. Return the 400 the client reads, never a bare 500.
  if (context !== null && !Array.isArray(context.recent)) return bad("context.recent must be an array");

  const result = await readStop(card as AdvisorCard, context);
  return Response.json(result, { status: 200 });
}
