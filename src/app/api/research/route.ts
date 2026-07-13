import { prisma } from "@/lib/db";
import { runResearch } from "@/lib/research/runResearch";
import type { Candidate } from "@/lib/research/propose";
import { ALLOWED_RANGES, ALLOWED_INTERVALS, type Range, type Interval } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isInterval = (v: unknown): v is Interval => typeof v === "string" && (ALLOWED_INTERVALS as readonly string[]).includes(v);
const isRange = (v: unknown): v is Range => typeof v === "string" && (ALLOWED_RANGES as readonly string[]).includes(v);

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
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!brief || !symbol) return Response.json({ error: "brief and symbol are required" }, { status: 400 });

  const interval = isInterval(body.interval) ? body.interval : "1h";
  const range = isRange(body.range) ? body.range : "3mo";
  const manualCandidates = parseManualCandidates(body.candidates);

  try {
    const { runId } = await runResearch(brief, symbol, interval, range, manualCandidates);
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
