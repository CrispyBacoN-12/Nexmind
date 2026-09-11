// POST /api/advisor/critique — the RAVEN boundary.
//
// The body is server-produced data making a round trip through the browser: the
// card the /api/advisor route just returned, and the bars it returned beside it.
// A mangled body yields a nonsense critique, and since nothing here is
// persisted, sized, or traded on, a shape check is the proportionate defence —
// not a full re-validation of every field.
//
// Nothing is written to the database in this version. Persistence belongs to
// the decision-journal work, which is a separate design.

import type { ChartBar } from "@/lib/advisor/chartSeries";
import { renderCritiqueContext } from "@/lib/advisor/critiqueContext";
import type { AdvisorCard } from "@/lib/advisor/types";
import { critiqueCard } from "@/lib/critic/advisorCritic";

export const dynamic = "force-dynamic";

/**
 * Longer than the 240s hard timeout inside callAgentCli, and longer than the
 * advisor route's own 120.
 *
 * The CLI spawns a subprocess behind a 3-way concurrency gate, so a realistic
 * round trip is 10-40s and a queued one is longer. If the platform kills the
 * request first, the owner gets a raw 504 that the UI cannot explain; if the
 * CLI's own timeout fires first, critiqueCard returns a degraded result with a
 * note, which the UI can.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const card = body.card;
  if (card == null || typeof card !== "object" || Array.isArray(card)) {
    return Response.json({ ok: false, error: "body.card is required" }, { status: 400 });
  }
  const c = card as Record<string, unknown>;

  if (typeof c.ticker !== "string" || c.ticker.trim() === "") {
    return Response.json({ ok: false, error: "card.ticker is required" }, { status: 400 });
  }
  if (typeof c.entry !== "number" || !Number.isFinite(c.entry)) {
    return Response.json({ ok: false, error: "card.entry must be a number" }, { status: 400 });
  }
  if (typeof c.stop !== "number" || !Number.isFinite(c.stop)) {
    return Response.json({ ok: false, error: "card.stop must be a number" }, { status: 400 });
  }
  if (c.sizing == null || typeof c.sizing !== "object") {
    return Response.json({ ok: false, error: "card.sizing is required" }, { status: 400 });
  }
  if (!Array.isArray(c.ladder)) {
    return Response.json({ ok: false, error: "card.ladder must be an array" }, { status: 400 });
  }

  // chart may legitimately be null: the position-in-range block then renders
  // n/a and RAVEN loses one class of argument, not the response.
  const chart = Array.isArray(body.chart) ? (body.chart as ChartBar[]) : null;

  // The checks above are a shape gate, not full validation: a card that clears
  // them can still be missing a nested field the renderer reads unguarded, and
  // that throws. Catch it here so a malformed card comes back as the 400 the
  // client knows how to read, never as a bare 500 with no body.
  let facts: string;
  try {
    facts = renderCritiqueContext(card as AdvisorCard, chart);
  } catch {
    return Response.json({ ok: false, error: "card shape is invalid" }, { status: 400 });
  }

  const result = await critiqueCard(facts);
  return Response.json(result, { status: 200 });
}
