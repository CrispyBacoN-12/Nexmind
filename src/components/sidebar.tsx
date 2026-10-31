"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Compass, NotebookPen, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/scan", label: "Scanner", icon: Radar },
  { href: "/advisor", label: "Trade Advisor", icon: Compass },
  { href: "/journal", label: "Trade Journal", icon: NotebookPen },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-(--color-border) bg-(--color-card) flex flex-col">
      <div className="px-5 py-6 border-b border-(--color-border)">
        <Link href="/advisor" className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Activity className="h-5 w-5 text-(--color-accent)" />
          <span>NEXMIND</span>
        </Link>
        <p className="text-[11px] text-(--color-muted) mt-1 font-mono">EXECUTION &amp; RISK COPILOT</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname.startsWith(item.href);
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
        no rule survived its hold-out — this tool sizes and watches risk, it does not pick
      </div>
    </aside>
  );
}
