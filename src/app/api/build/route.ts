import { prisma } from "@/lib/db";
import { proposeBuild } from "@/lib/codegen/builder";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Generate a build proposal (does NOT write any files). POST { request }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const request = typeof body.request === "string" ? body.request.trim() : "";
  if (!request) return Response.json({ error: "request is required" }, { status: 400 });

  const proposal = await proposeBuild(request);
  const job = await prisma.buildJob.create({
    data: {
      request,
      status: "proposed",
      notes: proposal.notes,
      files: JSON.stringify(proposal.files),
      costUsd: proposal.costUsd,
    },
  });

  return Response.json({ jobId: job.id, ...proposal });
}

// List recent build jobs.
export async function GET() {
  const jobs = await prisma.buildJob.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
  return Response.json(jobs);
}
