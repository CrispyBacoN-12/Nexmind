"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, Terminal, Users, Network, FileBarChart, Activity, Hammer, LineChart, Landmark, FlaskConical, ScrollText, Trophy, Microscope } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "War Room", icon: Radar },
  { href: "/command", label: "Command Bridge", icon: Terminal },
  { href: "/analyze", label: "AI Analysis", icon: LineChart },
  { href: "/invest", label: "Stock Advisor", icon: Landmark },
  { href: "/backtest", label: "Backtest Lab", icon: FlaskConical },
  { href: "/research", label: "Quant Research", icon: Microscope },
  { href: "/build", label: "Builder Studio", icon: Hammer },
  { href: "/roster", label: "Agent Roster", icon: Users },
  { href: "/graph", label: "Team Graph", icon: Network },
  { href: "/scoreboard", label: "Scoreboard", icon: Trophy },
  { href: "/activity", label: "Scan Activity", icon: ScrollText },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

export function Sidebar({ online = 0 }: { online?: number }) {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-(--color-border) bg-(--color-card) flex flex-col">
      <div className="px-5 py-6 border-b border-(--color-border)">
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Activity className="h-5 w-5 text-(--color-accent)" />
          <span>NEXMIND</span>
        </Link>
        <p className="text-[11px] text-(--color-muted) mt-1 font-mono">AI TRADING GUILD</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                active ? "bg-(--color-accent)/10 text-(--color-accent) font-medium" : "text-(--color-foreground)/80 hover:bg-(--color-border)/40",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-(--color-border) text-xs text-(--color-muted) font-mono">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 live-dot mr-2 align-middle" />
        {online} agents online
        <div className="mt-1 text-[10px]">PAPER MODE · no broker</div>
      </div>
    </aside>
  );
}
