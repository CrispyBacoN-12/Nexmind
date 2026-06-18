"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardTitle, Button, Badge, PageHeader, Empty } from "@/components/ui";
import { validateTarget } from "@/lib/codegen/guardrails";

interface ProposedFile { path: string; action: "create" | "overwrite"; content: string }
interface ApplyRes { path: string; status: string; reason?: string }
type ApplyState =
  | { phase: "idle" }
  | { phase: "applied"; results: ApplyRes[] }
  | { phase: "rolledback"; errors: string };

export const HANDOFF_KEY = "nexmind:buildRequest";
const PREVIEW_ROUTE = "/nexmind-preview";

function routeFor(p: string): string | null {
  const m = p.match(/^src\/app\/(.+)\/page\.tsx$/);
  return m ? "/" + m[1] : null;
}

function hasPageFile(files: { path: string }[]): boolean {
  return files.some((f) => {
    const p = f.path.replace(/\\/g, "/").toLowerCase();
    return /^src\/app\/.+\/page\.tsx$/.test(p) || (p.startsWith("src/app/") && p.endsWith(".tsx"));
  });
}

export default function BuilderPage() {
  const [request, setRequest] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [files, setFiles] = useState<ProposedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"" | "gen" | "apply" | "preview">("");
  const [apply, setApply] = useState<ApplyState>({ phase: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewMsg, setPreviewMsg] = useState("");

  // Accept a handoff from the Command Bridge (request stashed in sessionStorage).
  useEffect(() => {
    const handoff = sessionStorage.getItem(HANDOFF_KEY);
    if (handoff) {
      sessionStorage.removeItem(HANDOFF_KEY);
      setRequest(handoff);
      void generate(handoff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(text?: string) {
    const req = (text ?? request).trim();
    if (!req || busy) return;
    // Best-effort: tear down a leftover preview sandbox from the previous job.
    if (jobId != null && preview) {
      void fetch("/api/build/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, clear: true }) });
    }
    setBusy("gen"); setFiles([]); setApply({ phase: "idle" }); setJobId(null); setPreview(null); setPreviewMsg("");
    try {
      const res = await fetch("/api/build", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: req }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setJobId(data.jobId); setFiles(data.files ?? []); setNotes(data.notes ?? "");
    } finally { setBusy(""); }
  }

  async function doPreview() {
    if (jobId == null || busy) return;
    setBusy("preview"); setPreviewMsg("");
    try {
      const res = await fetch("/api/build/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const d = await res.json();
      if (d.ok && d.previewUrl) setPreview(`${d.previewUrl}?t=${Date.now()}`);
      else { setPreview(null); setPreviewMsg(d.reason || d.error || "cannot preview this proposal"); }
    } finally { setBusy(""); }
  }

  async function discardPreview() {
    if (jobId == null || busy) return;
    setBusy("preview");
    try {
      await fetch("/api/build/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, clear: true }),
      });
      setPreview(null);
    } finally { setBusy(""); }
  }

  async function applyBuild() {
    if (jobId == null || busy) return;
    const blocked = files.filter((f) => !validateTarget(f.path).ok);
    if (blocked.length && !confirm(`${blocked.length} file(s) will be skipped by guardrails. Apply the rest?`)) return;
    setBusy("apply");
    try {
      const res = await fetch("/api/build/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }), // verify defaults ON server-side
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setPreview(null); // server tears down the sandbox on commit
      if (data.rolledBack) setApply({ phase: "rolledback", errors: data.errors ?? "compile failed" });
      else setApply({ phase: "applied", results: data.results ?? [] });
    } finally { setBusy(""); }
  }

  async function rollback() {
    if (jobId == null || busy) return;
    setBusy("apply");
    try {
      await fetch("/api/build/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, rollback: true }),
      });
      setApply({ phase: "idle" });
    } finally { setBusy(""); }
  }

  const appliedResults = apply.phase === "applied" ? apply.results : null;

  return (
    <div>
      <PageHeader
        title="Builder Studio"
        description="Describe a page — NOVA proposes files, you review, Apply writes them, and a type-check auto-rolls-back anything that won't compile."
        action={<Badge tone="warning">writes to disk · auto-verified</Badge>}
      />

      <Card className="mb-5">
        <CardTitle>💻 NOVA — describe what to build</CardTitle>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={3}
          placeholder='เช่น "หน้า analytics สรุปกำไรรายเดือนเป็นการ์ดสถิติ 4 อัน + ตารางไม้ล่าสุด"'
          className="w-full rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)/50"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => generate()} disabled={!!busy}>{busy === "gen" ? "NOVA is working…" : "Generate proposal"}</Button>
          <span className="text-xs text-(--color-muted)">เขียนได้เฉพาะ <code className="font-mono">src/app</code>, <code className="font-mono">src/components</code> · กันไฟล์สำคัญ + ตรวจ compile อัตโนมัติ</span>
        </div>
      </Card>

      {files.length === 0 ? (
        <Empty title="No proposal yet" hint="Generate a proposal — or send one over from the Command Bridge." />
      ) : (
        <div className="space-y-3">
          {notes && (
            <Card className="border-(--color-accent)/30">
              <CardTitle>NOVA notes</CardTitle>
              <p className="text-sm whitespace-pre-wrap">{notes}</p>
            </Card>
          )}

          {files.map((f, i) => {
            const guard = validateTarget(f.path);
            const route = routeFor(f.path);
            const row = appliedResults?.find((r) => r.path === f.path || r.path === guard.relPath);
            return (
              <Card key={i} className={guard.ok ? "" : "border-rose-500/40"}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{f.path}</span>
                    <Badge tone={f.action === "create" ? "positive" : "warning"}>{f.action}</Badge>
                    {guard.ok ? <Badge tone="info">allowed</Badge> : <Badge tone="negative">blocked: {guard.reason}</Badge>}
                    {row && <Badge tone={row.status === "written" ? "positive" : "negative"}>{row.status}{row.reason ? `: ${row.reason}` : ""}</Badge>}
                  </div>
                  {row?.status === "written" && route && (
                    <Link href={route} className="text-xs text-(--color-accent) hover:underline font-mono" target="_blank">open {route} ↗</Link>
                  )}
                </div>
                <details className="mt-2">
                  <summary className="text-[11px] text-(--color-muted) cursor-pointer hover:text-(--color-foreground)">view content ({f.content.split("\n").length} lines)</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded bg-(--color-background) border border-(--color-border) p-3 text-[11px] font-mono leading-relaxed whitespace-pre">{f.content}</pre>
                </details>
              </Card>
            );
          })}

          <div className="flex items-center gap-3 pt-1 flex-wrap">
            {apply.phase === "idle" && hasPageFile(files) && (
              <Button onClick={doPreview} disabled={!!busy} variant="outline">{busy === "preview" ? "Rendering…" : "👁 Preview first"}</Button>
            )}
            {apply.phase === "idle" && (
              <Button onClick={applyBuild} disabled={!!busy}>{busy === "apply" ? "Applying + verifying…" : "✓ Apply + verify build"}</Button>
            )}
            {previewMsg && <span className="text-xs text-amber-400">{previewMsg}</span>}
            {apply.phase === "applied" && (
              <>
                <Badge tone="positive">✓ applied & compiles · {appliedResults!.filter((r) => r.status === "written").length} file(s)</Badge>
                <Button onClick={rollback} disabled={!!busy} variant="danger">↩ Rollback</Button>
              </>
            )}
            {apply.phase === "rolledback" && (
              <div className="w-full">
                <Badge tone="negative">✗ build failed — auto-rolled back (app is safe)</Badge>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-rose-950/30 border border-rose-500/30 p-3 text-[11px] font-mono text-rose-200 whitespace-pre-wrap">{apply.errors}</pre>
                <Button onClick={() => generate()} disabled={!!busy} variant="outline" className="mt-2">↻ Regenerate</Button>
              </div>
            )}
          </div>

          {preview && (
            <Card>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <CardTitle className="mb-0">👁 Live preview</CardTitle>
                  <Badge tone="warning">sandbox · not applied yet</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={applyBuild} disabled={!!busy}>{busy === "apply" ? "Applying…" : "✓ Looks good — Apply"}</Button>
                  <Button size="sm" variant="danger" onClick={discardPreview} disabled={!!busy}>Discard</Button>
                </div>
              </div>
              <div className="rounded-md border border-(--color-border) overflow-hidden">
                <div className="flex items-center gap-1.5 px-3 py-2 bg-(--color-card-2) border-b border-(--color-border)">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 text-[11px] font-mono text-(--color-muted)">{PREVIEW_ROUTE}</span>
                </div>
                <iframe src={preview} title="preview" className="w-full h-[640px] bg-(--color-background)" />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
