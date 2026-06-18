"use client";

import { useState } from "react";
import { YggdrasilBg } from "./yggdrasil-bg";
import { AgentModal } from "./agent-modal";
import { Avatar } from "./avatar";
import { cn, fmtMoney, colorForChange } from "@/lib/utils";

export interface SceneAgent {
  codename: string;
  role: string;
  team: string;
  status: string;
  emoji: string;
  modelTier: string;
}

export interface CoreInfo {
  openTrades: number;
  realizedPnl: number;
  winRate: number;
  lastDecision: string | null;
}

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

const GROVE_ORDER = ["Dev", "Design", "Content", "Intelligence", "Finance", "Systems"];

function seatClass(status: string): string {
  return status === "online" ? "seat-online" : status === "working" ? "seat-working" : status === "idle" ? "seat-idle" : "seat-offline";
}

// Stable per-codename delay so seats bob out of sync.
function delayFor(codename: string): string {
  let h = 0;
  for (const c of codename) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return `${(h % 30) / 10}s`;
}

function Seat({ a, onClick }: { a: SceneAgent; onClick: (c: string) => void }) {
  return (
    <button
      onClick={() => onClick(a.codename)}
      className="ygg-seat flex flex-col items-center gap-1 w-[68px] cursor-pointer focus:outline-none"
      title={`${a.codename} · ${a.role} · ${a.status} · click for details`}
    >
      <div className="seat-live" style={{ animationDelay: delayFor(a.codename) }}>
        <div className={cn("h-12 w-12 rounded-full overflow-hidden bg-(--color-card-2)", seatClass(a.status))}>
          <Avatar codename={a.codename} emoji={a.emoji} />
        </div>
      </div>
      <div className="h-1 w-10 rounded-full bg-(--color-ygg-bark)" />
      <span className="text-[10px] font-mono text-(--color-foreground)/85 truncate w-full text-center">{a.codename}</span>
    </button>
  );
}

function Grove({ team, agents, onSelect }: { team: string; agents: SceneAgent[]; onSelect: (c: string) => void }) {
  const online = agents.filter((a) => a.status === "online" || a.status === "working").length;
  return (
    <div className="ygg-grove rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{team}</h3>
          <p className="text-[10px] ygg-runes uppercase">{REALMS[team] ?? team}</p>
        </div>
        <span className="text-[10px] text-(--color-muted) font-mono shrink-0">{online}/{agents.length} ⚡</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {agents.map((a) => <Seat key={a.codename} a={a} onClick={onSelect} />)}
      </div>
    </div>
  );
}

function Trunk({ agents, core, onSelect }: { agents: SceneAgent[]; core: CoreInfo; onSelect: (c: string) => void }) {
  return (
    <div className="ygg-trunk rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold tracking-tight">⚔️ The Trunk — Trading Desk</h3>
        <span className="text-[10px] ygg-runes uppercase">{REALMS.Trading}</span>
      </div>
      <p className="text-xs text-(--color-muted) mb-4">Scanner → Hawk×3 → Sage → Iron Rules → execution</p>

      <div className="flex flex-wrap gap-4 justify-center mb-4">
        {agents.map((a) => <Seat key={a.codename} a={a} onClick={onSelect} />)}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center border-t border-(--color-ygg-gold)/20 pt-3">
        <div>
          <div className="text-lg font-semibold tabular-nums">{core.openTrades}</div>
          <div className="text-[10px] text-(--color-muted) uppercase">open</div>
        </div>
        <div>
          <div className={cn("text-lg font-semibold tabular-nums", colorForChange(core.realizedPnl))}>{fmtMoney(core.realizedPnl)}</div>
          <div className="text-[10px] text-(--color-muted) uppercase">realized</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums">{Math.round(core.winRate)}%</div>
          <div className="text-[10px] text-(--color-muted) uppercase">win rate</div>
        </div>
      </div>
      {core.lastDecision && (
        <p className="mt-3 text-[11px] font-mono text-(--color-accent-2)/90 text-center truncate">↯ {core.lastDecision}</p>
      )}
    </div>
  );
}

export function OfficeScene({ agents, core }: { agents: SceneAgent[]; core: CoreInfo }) {
  const [selected, setSelected] = useState<string | null>(null);
  const byTeam = (t: string) => agents.filter((a) => a.team === t);
  const hq = byTeam("HQ");
  const trading = byTeam("Trading");

  return (
    <div className="ygg-scene relative rounded-2xl border border-(--color-border) overflow-hidden p-6">
      <YggdrasilBg />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {hq.length > 0 && (
          <div className="ygg-grove rounded-xl px-6 py-4">
            <p className="text-[10px] ygg-runes uppercase text-center mb-3">{REALMS.HQ}</p>
            <div className="flex gap-6 justify-center">{hq.map((a) => <Seat key={a.codename} a={a} onClick={setSelected} />)}</div>
          </div>
        )}

        <div className="w-full max-w-2xl">
          <Trunk agents={trading} core={core} onSelect={setSelected} />
        </div>

        <div className="grid gap-4 w-full sm:grid-cols-2 lg:grid-cols-3">
          {GROVE_ORDER.filter((t) => byTeam(t).length > 0).map((t) => (
            <Grove key={t} team={t} agents={byTeam(t)} onSelect={setSelected} />
          ))}
        </div>
      </div>

      {selected && <AgentModal codename={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
