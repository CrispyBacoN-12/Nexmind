import { prisma } from "@/lib/db";
import { writePreview, clearPreview, PREVIEW_ROUTE, type ProposedFile, type PreviewBackup } from "@/lib/codegen/builder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Render a proposal into the /_preview sandbox (or tear it down).
// POST { jobId, clear? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const jobId = Number(body.jobId);
  const clear = body.clear === true;
  if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });

  const job = await prisma.buildJob.findUnique({ where: { id: jobId } });
  if (!job) return Response.json({ error: "build job not found" }, { status: 404 });

  const root = process.cwd();
  const existing = safeParse<PreviewBackup[]>(job.preview, []);

  if (clear) {
    await clearPreview(root, existing);
    await prisma.buildJob.update({ where: { id: jobId }, data: { preview: "[]" } });
    return Response.json({ ok: true, cleared: true });
  }

  // Replace any prior preview first, then write the new one.
  if (existing.length) await clearPreview(root, existing);

  const files = safeParse<ProposedFile[]>(job.files, []);
  const { backup, hasPage } = await writePreview(root, files);
  await prisma.buildJob.update({ where: { id: jobId }, data: { preview: JSON.stringify(backup) } });

  if (!hasPage) return Response.json({ ok: false, reason: "no page to preview (component-only proposal)" });
  return Response.json({ ok: true, previewUrl: PREVIEW_ROUTE });
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
