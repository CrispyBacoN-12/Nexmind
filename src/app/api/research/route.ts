import { prisma } from "@/lib/db";
import { runResearch } from "@/lib/research/runResearch";
import type { Candidate } from "@/lib/research/propose";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Optional hand-authored candidates (e.g. written by Claude in conversation)
// bypass the Anthropic API proposal call entirely — see runResearch()'s
// manualCandidates param.
function parseManualCandidates(v: unknown): Candidate[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const parsed = v
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => typeof c.label === "string" && typeof c.code === "string")
    .map((c) => ({ label: c.label as string, code: c.code as string, rationale: typeof c.rationale === "string" ? c.rationale : "" }));
  return parsed.length ? parsed : undefined;
}

// Kick off a new research run from a brief. Runs fully server-side before
// responding, mirroring /api/pipeline's blocking POST + follow-up GET-by-id.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return Response.json({ error: "brief is required" }, { status: 400 });

  // symbol/interval/range are rejected rather than ignored. Since 2026-08-25
  // every round runs the whole S&P 500 panel on daily bars over the FIT fold, so
  // a caller who sent "AAPL 1h" would otherwise get a run that has nothing to do
  // with what they asked for and no way to tell.
  for (const dead of ["symbol", "interval", "range"]) {
    if (body[dead] !== undefined) {
      return Response.json(
        { error: `${dead} is no longer accepted — research runs the full S&P 500 panel over the FIT fold` },
        { status: 400 },
      );
    }
  }

  const manualCandidates = parseManualCandidates(body.candidates);

  try {
    const { runId } = await runResearch(brief, manualCandidates);
    return Response.json({ runId });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// Poll a research run (?id=N) or list recent runs.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const run = await prisma.researchRun.findUnique({
      where: { id: Number(id) },
      include: { strategies: { orderBy: { id: "asc" } } },
    });
    if (!run) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(run);
  }
  const runs = await prisma.researchRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  return Response.json(runs);
}
