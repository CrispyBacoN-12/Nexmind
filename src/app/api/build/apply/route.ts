import { prisma } from "@/lib/db";
import { applyFiles, rollbackFiles, clearPreview, type ProposedFile, type PreviewBackup } from "@/lib/codegen/builder";
import { typecheck, focusErrors } from "@/lib/codegen/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Apply a proposed build to disk, then verify it compiles. On compile failure
// the change is rolled back automatically so the app stays healthy.
// POST { jobId, rollback?, verify? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const jobId = Number(body.jobId);
  const rollback = body.rollback === true;
  const verify = body.verify !== false; // default ON
  if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });

  const job = await prisma.buildJob.findUnique({ where: { id: jobId } });
  if (!job) return Response.json({ error: "build job not found" }, { status: 404 });

  const root = process.cwd();

  // Manual rollback request.
  if (rollback) {
    const backup = safeParse<{ path: string; previous: string | null }[]>(job.backup, []);
    await rollbackFiles(root, backup);
    await prisma.buildJob.update({ where: { id: jobId }, data: { status: "proposed", result: "rolled back", appliedAt: null } });
    return Response.json({ ok: true, rolledBack: true });
  }

  if (job.status === "applied") return Response.json({ error: "already applied" }, { status: 409 });

  // 0) Tear down any live preview first, so applyFiles captures the true original
  //    content as the rollback baseline (not the preview-written content).
  const previewBackup = safeParse<PreviewBackup[]>(job.preview, []);
  if (previewBackup.length) {
    await clearPreview(root, previewBackup);
    await prisma.buildJob.update({ where: { id: jobId }, data: { preview: "[]" } });
  }

  // 1) Write files (guardrails enforced inside applyFiles).
  const files = safeParse<ProposedFile[]>(job.files, []);
  const results = await applyFiles(root, files);
  const written = results.filter((r) => r.status === "written");
  const skipped = results.filter((r) => r.status === "skipped");
  const backup = written.map((r) => ({ path: r.path, previous: r.previous }));

  if (written.length === 0) {
    await prisma.buildJob.update({
      where: { id: jobId },
      data: { status: "failed", result: JSON.stringify(results.map(slim)), appliedAt: new Date() },
    });
    return Response.json({ ok: false, verified: false, results }, { status: 400 });
  }

  // 2) Verify it compiles; auto-rollback on failure.
  if (verify) {
    const check = await typecheck(root);
    if (!check.ok) {
      await rollbackFiles(root, backup);
      const errors = focusErrors(check.output, written.map((w) => w.path));
      await prisma.buildJob.update({
        where: { id: jobId },
        data: { status: "failed", result: `compile failed, rolled back:\n${errors}`.slice(0, 8000), appliedAt: new Date() },
      });
      return Response.json({ ok: false, verified: false, rolledBack: true, results, errors });
    }
  }

  // 3) Success — keep the change.
  await prisma.buildJob.update({
    where: { id: jobId },
    data: {
      status: "applied",
      backup: JSON.stringify(backup),
      result: JSON.stringify(results.map(slim)),
      appliedAt: new Date(),
    },
  });

  return Response.json({ ok: true, verified: verify, results, skipped: skipped.length });
}

const slim = (r: { path: string; status: string; reason?: string }) => ({ path: r.path, status: r.status, reason: r.reason });

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
