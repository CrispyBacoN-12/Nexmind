"use client";

import { useState } from "react";
import { YggdrasilBg } from "./yggdrasil-bg";
import { AgentModal } from "./agent-modal";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";
import type { SceneAgent, CoreInfo } from "./scene";

const REALMS: Record<string, string> = {
  HQ: "Asgard · the high seat",
  Trading: "the Trunk · trading desk",
  Dev: "Svartálfheim · the forge",
  Design: "Álfheim · the light realm",
  Content: "Vanaheim · the storytellers",
  Intelligence: "Mímir's Well · deep knowledge",
  Finance: "Niðavellir · the gold halls",
  Systems: "Jötunheim · the old powers",
};
const ORDER = ["HQ", "Trading", "Intelligence", "Dev", "Design", "Systems", "Content", "Finance"];

function seatClass(status: string): string {
  return status === "online" ? "seat-online" : status === "working" ? "seat-working" : status === "idle" ? "seat-idle" : "seat-offline";
}
function bobDelay(codename: string): string {
  let h = 0;
  for (const c of codename) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return `${(h % 32) / 10}s`;
}

// Per-department room backdrop: drop public/office/<team>.png for real art.
function RoomBackdrop({ team }: { team: string }) {
  const [hasArt, setHasArt] = useState(true);
  const src = `/office/${team.toLowerCase()}.png`;
  if (!hasArt) {
    return (
      <div className="absolute inset-0 iso-room-fallback">
        <YggdrasilBg />
        <div className="iso-floor" />
        <div className="candle absolute left-[8%] top-[22%] h-16 w-16 rounded-full" style={{ background: "radial-gradient(circle, rgba(227,189,106,0.5), transparent 70%)" }} />
        <div className="candle absolute right-[8%] top-[22%] h-16 w-16 rounded-full" style={{ background: "radial-gradient(circle, rgba(227,189,106,0.5), transparent 70%)", animationDelay: "1.2s" }} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={team} className="absolute inset-0 w-full h-full object-cover pixelated" onError={() => setHasArt(false)} />
  );
}

function Character({ a, onClick, big }: { a: SceneAgent; onClick: (c: string) => void; big?: boolean }) {
  const size = big ? "h-16 w-16" : "h-11 w-11";
  return (
    <button
      onClick={() => onClick(a.codename)}
      className="group flex flex-col items-center cursor-pointer focus:outline-none"
      title={`${a.codename} · ${a.role} · ${a.status}`}
    >
      <div className="char-bob char-shadow" style={{ animationDelay: bobDelay(a.codename) }}>
        <div className={cn(size, "rounded-lg overflow-hidden bg-(--color-card-2)/80", seatClass(a.status))}>
          <Avatar codename={a.codename} emoji={a.emoji} variant="pixel-art" />
        </div>
      </div>
      <span className="text-[10px] font-mono text-(--color-foreground)/90 mt-1 px-1.5 rounded bg-black/40 group-hover:bg-black/70 truncate max-w-[80px]">
        {a.codename}
      </span>
      {big && <span className="text-[9px] text-(--color-muted) max-w-[90px] text-center leading-tight">{a.role}</span>}
    </button>
  );
}

// ---- Level 1: the building lobby (department rooms) ----
function Lobby({ agents, onEnter }: { agents: SceneAgent[]; onEnter: (team: string) => void }) {
  const teams = ORDER.filter((t) => agents.some((a) => a.team === t));
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {teams.map((t) => {
          const members = agents.filter((a) => a.team === t);
          const online = members.filter((m) => m.status === "online" || m.status === "working").length;
          return (
            <button
              key={t}
              onClick={() => onEnter(t)}
              className="ygg-grove rounded-xl p-3 text-left transition hover:border-(--color-accent)/50 group"
            >
              {/* mini room preview with people peeking */}
              <div className="relative h-24 rounded-lg overflow-hidden iso-room-fallback mb-2">
                <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/50 to-transparent" />
                <div className="absolute inset-0 flex items-end justify-center gap-1 pb-2">
                  {members.slice(0, 4).map((m) => (
                    <div key={m.codename} className={cn("h-9 w-9 rounded overflow-hidden char-shadow", seatClass(m.status))}>
                      <Avatar codename={m.codename} emoji={m.emoji} variant="pixel-art" />
                    </div>
                  ))}
                </div>
                {members.length > 4 && (
                  <span className="absolute top-1.5 right-2 text-[10px] font-mono text-(--color-foreground)/80 bg-black/50 rounded px-1">+{members.length - 4}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm tracking-tight">{t}</h3>
                <span className="text-[10px] font-mono text-(--color-muted)">{online}/{members.length} ⚡</span>
              </div>
              <p className="text-[10px] ygg-runes uppercase truncate">{REALMS[t] ?? t}</p>
              <p className="text-[10px] text-(--color-accent) mt-1 opacity-0 group-hover:opacity-100 transition">enter room →</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Level 2: inside one department's room ----
function DepartmentRoom({ team, members, core, onBack, onSelect }: { team: string; members: SceneAgent[]; core: CoreInfo; onBack: () => void; onSelect: (c: string) => void }) {
  return (
    <div className="ygg-scene relative w-full aspect-[16/10] rounded-2xl border border-(--color-border) overflow-hidden">
      <RoomBackdrop team={team} />
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 120px 20px rgba(0,0,0,0.55)" }} />

      <div className="relative z-10 h-full flex flex-col">
        <div className="flex items-start justify-between p-4">
          <button onClick={onBack} className="text-xs font-mono rounded-md border border-(--color-border) bg-black/40 px-2.5 py-1 hover:border-(--color-accent)/50 transition">← all rooms</button>
          <div className="text-right">
            <h3 className="font-semibold tracking-tight">{team}</h3>
            <p className="text-[10px] ygg-runes uppercase">{REALMS[team] ?? team}</p>
            {team === "Trading" && <p className="text-[10px] font-mono text-(--color-accent-2)">{core.openTrades} open · {Math.round(core.winRate)}% win</p>}
          </div>
        </div>

        <div className="flex-1 grid place-items-center p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-5 justify-center max-w-2xl">
            {members.map((a) => <Character key={a.codename} a={a} onClick={onSelect} big />)}
          </div>
        </div>

        <p className="text-center text-[10px] text-(--color-muted) pb-3">click a member to see their votes, work &amp; lessons</p>
      </div>
    </div>
  );
}

export function IsoOffice({ agents, core }: { agents: SceneAgent[]; core: CoreInfo }) {
  const [room, setRoom] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const members = room ? agents.filter((a) => a.team === room) : [];

  return (
    <>
      {room ? (
        <DepartmentRoom team={room} members={members} core={core} onBack={() => setRoom(null)} onSelect={setSelected} />
      ) : (
        <Lobby agents={agents} onEnter={setRoom} />
      )}
      {selected && <AgentModal codename={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
