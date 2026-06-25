import { readFile } from "fs/promises";
import path from "path";
import { Card, CardTitle, Badge, PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Row { time: string; msg: string; tone: "executed" | "vetoed" | "quiet" | "error" | "info" }

function classify(msg: string): Row["tone"] {
  if (/executed|OPEN |\bwin\b|TP1 /.test(msg)) return "executed";
  if (/\bloss\b|ERROR|FATAL|failed/.test(msg)) return "error";
  if (/vetoed|VETO/.test(msg)) return "vetoed";
  if (/setups|universe=|full \(|managed \d/.test(msg)) return "info";
  return "quiet"; // no-setup / already-open / no-consensus
}

const toneClass: Record<Row["tone"], string> = {
  executed: "text-emerald-400",
  vetoed: "text-amber-400",
  error: "text-rose-400",
  info: "text-(--color-accent-2)",
  quiet: "text-(--color-muted)",
};

async function readLog(maxLines = 150): Promise<Row[]> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), "scripts", "scan.log"), "utf8");
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(.+?)\]\s*(.*)$/); // only timestamped scan events
    if (!m) continue;
    const t = new Date(m[1]);
    const time = isNaN(t.getTime()) ? m[1] : t.toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    rows.push({ time, msg: m[2], tone: classify(m[2]) });
  }
  return rows.slice(-maxLines).reverse(); // newest first
}

export default async function ActivityPage() {
  const rows = await readLog();
  const executed = rows.filter((r) => r.tone === "executed").length;
  const vetoed = rows.filter((r) => r.tone === "vetoed").length;

  return (
    <div>
      <PageHeader
        title="Scan Activity"
        description="Every scheduled scan, newest first — proof the desks are working even when no trade opens. Refresh to update."
        action={<a href="/activity" className="rounded-md border border-(--color-border) px-3 py-1 text-xs hover:text-(--color-accent)">↻ Refresh</a>}
      />

      {rows.length === 0 ? (
        <Empty title="No scan activity yet" hint="The scheduler writes to scripts/scan.log on each run." />
      ) : (
        <>
          <div className="flex gap-2 mb-4 text-xs">
            <Badge tone="neutral">{rows.length} events</Badge>
            <Badge tone="positive">{executed} executed</Badge>
            <Badge tone="warning">{vetoed} vetoed</Badge>
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-(--color-border)/40 hover:bg-(--color-border)/10">
                      <td className="py-1.5 px-3 text-(--color-muted) whitespace-nowrap align-top">{r.time}</td>
                      <td className={`py-1.5 px-3 ${toneClass[r.tone]}`}>{r.msg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <p className="mt-3 text-[11px] text-(--color-muted)">Source: scripts/scan.log · System lines (data-provider fallbacks) are hidden.</p>
    </div>
  );
}
