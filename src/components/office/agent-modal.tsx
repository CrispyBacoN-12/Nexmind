"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { Avatar } from "./avatar";
import { fmtAgo } from "@/lib/utils";

interface Work { task: string; output: string | null; status: string; at: string; pipelineId: number }
interface VoteSet { symbol: string; side: string; at: string; votes: { persona: string; vote: string; reason: string }[] }
interface Verdict { symbol: string; at: string; verdict: string | null; kind: string }
interface SignalRow { symbol: string; side: string; status: string; at: string; note: string | null }
interface Lesson { text: string; at: string }

interface Detail {
  codename: string; name: string; role: string; team: string; emoji: string;
  rarity: string; modelTier: string; title: string | null; motto: string | null;
  skills: string[]; status: string;
  work: Work[]; votes?: VoteSet[]; verdicts?: Verdict[]; signals?: SignalRow[]; lessons?: Lesson[];
}

export function AgentModal({ codename, onClose }: { codename: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/agent?codename=${encodeURIComponent(codename)}`)
      .then((r) => r.json())
      .then((data) => { if (alive) { setD(data.error ? null : data); setLoading(false); } })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [codename]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl border border-(--color-ygg-gold)/30 bg-(--color-card) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading || !d ? (
          <div className="p-8 text-center text-sm text-(--color-muted)">{loading ? "Summoning…" : "No data."}</div>
        ) : (
          <>
            {/* header */}
            <div className="p-5 border-b border-(--color-border) bg-gradient-to-br from-(--color-ygg-leaf)/10 to-transparent">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-full overflow-hidden bg-(--color-card-2) border border-(--color-ygg-gold)/30"><Avatar codename={d.codename} emoji={d.emoji} /></div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">{d.codename}</h2>
                    <Badge tone="info">{d.rarity}</Badge>
                    <Badge tone="neutral">{d.modelTier}</Badge>
                  </div>
                  <p className="text-sm text-(--color-accent-2) font-mono">{d.role} · {d.team}</p>
                  {d.title && <p className="text-xs text-(--color-muted) mt-0.5">“{d.title}”</p>}
                </div>
                <button onClick={onClose} className="text-(--color-muted) hover:text-(--color-foreground) text-xl leading-none">✕</button>
              </div>
              {d.motto && <p className="text-xs text-(--color-muted) italic mt-3">{d.motto}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {d.skills.map((s) => <span key={s} className="text-[10px] rounded bg-(--color-card-2) border border-(--color-border) px-1.5 py-0.5 text-(--color-muted)">{s}</span>)}
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* HAWK votes */}
              {d.votes && d.votes.length > 0 && (
                <Section title="🦅 Recent votes">
                  {d.votes.map((v, i) => (
                    <div key={i} className="rounded-md border border-(--color-border) p-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono font-semibold">{v.symbol} {v.side.toUpperCase()}</span>
                        <span className="text-(--color-muted)">{fmtAgo(v.at)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {v.votes.map((x, j) => (
                          <span key={j} className="text-[11px] rounded bg-(--color-card-2) px-2 py-0.5" title={x.reason}>
                            <span className="text-(--color-accent-2)">{x.persona}</span> · {x.vote}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* SAGE verdicts */}
              {d.verdicts && d.verdicts.length > 0 && (
                <Section title="🛡️ Risk verdicts">
                  {d.verdicts.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge tone={v.kind === "veto" ? "negative" : "positive"}>{v.kind}</Badge>
                      <div className="flex-1">
                        <span className="font-mono">{v.symbol}</span>
                        <span className="text-(--color-muted)"> · {fmtAgo(v.at)}</span>
                        {v.verdict && <p className="text-(--color-muted) mt-0.5">{v.verdict}</p>}
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* SCANNER signals */}
              {d.signals && d.signals.length > 0 && (
                <Section title="📡 Recent scans">
                  {d.signals.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="text-(--color-muted) w-14 shrink-0">{fmtAgo(s.at)}</span>
                      <span>{s.symbol} {s.side}</span>
                      <Badge tone={s.status === "executed" ? "positive" : s.status === "vetoed" ? "warning" : "neutral"}>{s.status}</Badge>
                    </div>
                  ))}
                </Section>
              )}

              {/* recent pipeline work */}
              {d.work.length > 0 && (
                <Section title="🛠️ Recent work">
                  {d.work.map((w, i) => (
                    <div key={i} className="rounded-md border border-(--color-border) p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{w.task}</span>
                        <span className="text-(--color-muted)">{fmtAgo(w.at)}</span>
                      </div>
                      {w.output && <p className="text-xs text-(--color-muted) mt-1 line-clamp-3 whitespace-pre-wrap">{w.output}</p>}
                    </div>
                  ))}
                </Section>
              )}

              {/* lessons */}
              {d.lessons && d.lessons.length > 0 && (
                <Section title="🧠 Lessons learned">
                  {d.lessons.map((l, i) => (
                    <p key={i} className="text-xs"><span className="text-(--color-muted) font-mono mr-2">{fmtAgo(l.at)}</span>{l.text}</p>
                  ))}
                </Section>
              )}

              {d.work.length === 0 && !d.votes && !d.verdicts && !d.signals && !d.lessons && (
                <p className="text-sm text-(--color-muted) text-center py-4">No recorded activity yet for {d.codename}. Dispatch a command or run a trade tick to see this agent in action.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
