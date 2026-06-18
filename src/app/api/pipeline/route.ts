import { prisma } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline/secretary";

export const dynamic = "force-dynamic";

// Kick off a new pipeline from a free-text command.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return Response.json({ error: "command is required" }, { status: 400 });

  const { pipelineId } = await runPipeline(command);
  return Response.json({ pipelineId });
}

// Poll a pipeline (?id=N) or list recent pipelines.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: Number(id) },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!pipeline) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(pipeline);
  }
  const pipelines = await prisma.pipeline.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  return Response.json(pipelines);
}
