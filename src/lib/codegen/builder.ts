// NOVA, the frontend builder. Proposes file changes as structured JSON — it does
// NOT touch disk here. Applying is a separate, guarded step (applyFiles).

import { promises as fs } from "fs";
import path from "path";
import { callAgentJSON, aiEnabled } from "@/lib/anthropic";
import { resolveWithinProject } from "./guardrails";

export type FileAction = "create" | "overwrite";
export interface ProposedFile {
  path: string; // project-relative
  action: FileAction;
  content: string;
}
export interface BuildProposal {
  files: ProposedFile[];
  notes: string;
  costUsd: number;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "overwrite"] },
          content: { type: "string" },
        },
        required: ["path", "action", "content"],
      },
    },
  },
  required: ["files", "notes"],
};

const SYSTEM = `You are NOVA, frontend developer for the NEXMIND app.
Stack: Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript.
Write production-ready files. Rules:
- Put new pages at src/app/<route>/page.tsx and components at src/components/<name>.tsx.
- ONLY write files under src/app or src/components, extensions .tsx/.ts/.css.
- NEVER modify layout.tsx, globals.css, db.ts, anthropic.ts, or any trading logic.
- Reuse the existing UI kit from "@/components/ui": Card, CardTitle, Stat, Button, Badge, Empty, PageHeader, StatusDot.
- Use the theme tokens already defined: classes like bg-(--color-card), border-(--color-border), text-(--color-muted), text-(--color-accent).
- Default exports for pages. Keep it self-contained; no new dependencies.
Return JSON { notes, files:[{path, action, content}] }.`;

export async function proposeBuild(request: string): Promise<BuildProposal> {
  if (!aiEnabled()) return mockProposal(request);

  const r = await callAgentJSON<{ files: ProposedFile[]; notes: string }>({
    tier: "sonnet",
    system: SYSTEM,
    prompt: `Build request: "${request}"\nProduce the file(s). Prefer one focused page or component.`,
    maxTokens: 4000,
    jsonSchema: SCHEMA,
  });
  return { files: r.data.files ?? [], notes: r.data.notes ?? "", costUsd: r.costUsd };
}

export interface ApplyResult {
  path: string;
  status: "written" | "skipped";
  reason?: string;
  /** Previous content (null when the file did not exist) — used for rollback. */
  previous: string | null;
}

/** Write the proposed files to disk, enforcing guardrails. Returns per-file results. */
export async function applyFiles(projectRoot: string, files: ProposedFile[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const f of files) {
    const g = resolveWithinProject(projectRoot, f.path);
    if (!g.ok || !g.absPath) {
      results.push({ path: f.path, status: "skipped", reason: g.reason, previous: null });
      continue;
    }
    let previous: string | null = null;
    try {
      previous = await fs.readFile(g.absPath, "utf8");
    } catch {
      previous = null; // new file
    }
    await fs.mkdir(path.dirname(g.absPath), { recursive: true });
    await fs.writeFile(g.absPath, f.content, "utf8");
    results.push({ path: g.relPath!, status: "written", previous });
  }
  return results;
}

/** Restore files to their captured previous content (or delete if they were new). */
export async function rollbackFiles(
  projectRoot: string,
  backup: { path: string; previous: string | null }[],
): Promise<void> {
  for (const b of backup) {
    const g = resolveWithinProject(projectRoot, b.path);
    if (!g.ok || !g.absPath) continue;
    if (b.previous == null) {
      await fs.rm(g.absPath, { force: true });
    } else {
      await fs.writeFile(g.absPath, b.previous, "utf8");
    }
  }
}

// ---- live preview sandbox ----

// NOTE: must NOT start with "_" — Next treats _folders as private (non-routable).
export const PREVIEW_ROUTE = "/nexmind-preview";
const PREVIEW_DIR = "nexmind-preview";
const PREVIEW_PAGE = `src/app/${PREVIEW_DIR}/page.tsx`;

export interface PreviewBackup { path: string; previous: string | null }

const POSIX = (p: string) => p.replace(/\\/g, "/");

/** Identify the page file to render (the route's page.tsx, else any .tsx under src/app). */
function pickPage(files: ProposedFile[]): ProposedFile | undefined {
  return (
    files.find((f) => /^src\/app\/.+\/page\.tsx$/i.test(POSIX(f.path))) ??
    files.find((f) => POSIX(f.path).toLowerCase().startsWith("src/app/") && f.path.endsWith(".tsx"))
  );
}

async function readOrNull(abs: string): Promise<string | null> {
  try { return await fs.readFile(abs, "utf8"); } catch { return null; }
}

/**
 * Write the proposal into an isolated `/_preview` sandbox so it can be rendered
 * without touching the real route. The page goes to src/app/_preview/page.tsx;
 * any new component files are written to their real (guarded) paths so imports
 * resolve. Returns a backup list for tearing the preview down again.
 */
export async function writePreview(projectRoot: string, files: ProposedFile[]): Promise<{ backup: PreviewBackup[]; hasPage: boolean }> {
  const page = pickPage(files);
  const backup: PreviewBackup[] = [];

  for (const f of files) {
    if (f === page) continue;
    const g = resolveWithinProject(projectRoot, f.path);
    if (!g.ok || !g.absPath) continue; // skip anything guardrails reject
    backup.push({ path: g.relPath!, previous: await readOrNull(g.absPath) });
    await fs.mkdir(path.dirname(g.absPath), { recursive: true });
    await fs.writeFile(g.absPath, f.content, "utf8");
  }

  if (page) {
    const g = resolveWithinProject(projectRoot, PREVIEW_PAGE);
    if (g.ok && g.absPath) {
      backup.push({ path: g.relPath!, previous: await readOrNull(g.absPath) });
      await fs.mkdir(path.dirname(g.absPath), { recursive: true });
      await fs.writeFile(g.absPath, f_pageContent(page), "utf8");
    }
  }

  return { backup, hasPage: Boolean(page) };
}

// Preview page should be the route default export; pass content through unchanged.
const f_pageContent = (f: ProposedFile) => f.content;

/** Tear down the preview: restore/remove sandbox files, then drop the _preview dir. */
export async function clearPreview(projectRoot: string, backup: PreviewBackup[]): Promise<void> {
  await rollbackFiles(projectRoot, backup);
  await fs.rm(path.join(projectRoot, "src", "app", PREVIEW_DIR), { recursive: true, force: true });
}

// ---- mock path (no API key) ----
// Produces a clearly-"generated" page that visibly reflects the request, so the
// preview obviously differs from existing pages even without an API key.
function mockProposal(request: string): BuildProposal {
  const slug = (request.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 3).join("-") || "page").replace(/[^a-z0-9-]/g, "") || "page";
  const route = `src/app/${slug}/page.tsx`;
  const c = request.toLowerCase();
  const wantsTable = /table|ตาราง|list|รายการ|history|log/.test(c);
  const wantsChart = /chart|graph|กราฟ|trend|line|bar/.test(c);
  const title = escapeQuotes(request).slice(0, 60);

  const sections: string[] = [
    `      {/* hero — makes it obvious this is a freshly generated page */}
      <div className="rounded-xl border border-(--color-accent)/40 bg-gradient-to-br from-(--color-accent)/15 to-transparent p-8 mb-6">
        <div className="text-4xl mb-2">🛠️</div>
        <h2 className="text-2xl font-semibold tracking-tight">${title}</h2>
        <p className="text-sm text-(--color-muted) mt-1">Generated by NOVA · mock preview — add an ANTHROPIC_API_KEY for real output.</p>
        <span className="inline-block mt-3 text-[11px] font-mono px-2 py-0.5 rounded bg-(--color-accent)/15 text-(--color-accent)">route: /${slug}</span>
      </div>`,
    `      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Generated stat" value="1,280" sub="+4.2%" subColor="text-emerald-400" />
        <Stat label="Built by" value="NOVA" sub="frontend agent" />
        <Stat label="Mode" value="mock" sub="no API key" />
        <Stat label="Status" value="preview" subColor="text-(--color-accent)" />
      </div>`,
  ];

  if (wantsChart) {
    sections.push(`      <Card className="mb-6">
        <CardTitle>Chart (placeholder)</CardTitle>
        <div className="h-48 flex items-end gap-2">
          {[40, 65, 50, 80, 60, 92, 75].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-(--color-accent)/40" style={{ height: \`\${h}%\` }} />
          ))}
        </div>
      </Card>`);
  }

  if (wantsTable) {
    sections.push(`      <Card className="mb-6">
        <CardTitle>Table (placeholder)</CardTitle>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-(--color-muted) border-b border-(--color-border)"><th className="py-2">Item</th><th>Value</th><th>Change</th></tr></thead>
          <tbody>
            {[["Alpha", "1,204", "+3.1%"], ["Bravo", "880", "-1.2%"], ["Charlie", "642", "+0.8%"]].map((r) => (
              <tr key={r[0]} className="border-b border-(--color-border)/50"><td className="py-2 font-mono">{r[0]}</td><td className="tabular-nums">{r[1]}</td><td className="text-(--color-accent)">{r[2]}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>`);
  }

  sections.push(`      <Card>
        <CardTitle>Your request</CardTitle>
        <p className="text-sm text-(--color-muted)">${escapeQuotes(request)}</p>
      </Card>`);

  const content = `import { PageHeader, Card, CardTitle, Stat } from "@/components/ui";

export default function GeneratedPage() {
  return (
    <div>
      <PageHeader title="${title}" description="A NOVA-generated page (mock)." />
${sections.join("\n")}
    </div>
  );
}
`;

  const extras = [wantsChart && "a chart", wantsTable && "a table"].filter(Boolean).join(" and ");
  return {
    files: [{ path: route, action: "create", content }],
    notes: `Mock build at /${slug}: a hero banner${extras ? ", " + extras : ""}, a stat grid, and your request echoed back. This is a placeholder — add an ANTHROPIC_API_KEY so NOVA writes a real page tailored to your description.`,
    costUsd: 0,
  };
}

const escapeQuotes = (s: string) => s.replace(/"/g, "'").replace(/`/g, "'");
