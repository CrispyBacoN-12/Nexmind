import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-(--color-border) bg-(--color-card) p-5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-xs font-medium uppercase tracking-wide text-(--color-muted) mb-2", className)}>{children}</h3>;
}

export function Stat({ label, value, sub, subColor }: { label: string; value: ReactNode; sub?: ReactNode; subColor?: string }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub != null && <div className={cn("text-sm mt-1 tabular-nums", subColor ?? "text-(--color-muted)")}>{sub}</div>}
    </Card>
  );
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: ComponentProps<"button"> & { variant?: "default" | "ghost" | "outline" | "danger"; size?: "sm" | "md" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer";
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm" };
  const variants = {
    default: "bg-(--color-accent) text-black hover:opacity-90",
    ghost: "hover:bg-(--color-border)/40",
    outline: "border border-(--color-border) hover:bg-(--color-border)/40",
    danger: "text-rose-400 hover:bg-rose-500/10",
  };
  return <button className={cn(base, sizes[size], variants[variant], className)} {...props} />;
}

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "positive" | "negative" | "warning" | "info"; className?: string; title?: string }) {
  const tones = {
    neutral: "bg-zinc-500/10 text-zinc-400",
    positive: "bg-emerald-500/10 text-emerald-400",
    negative: "bg-rose-500/10 text-rose-400",
    warning: "bg-amber-500/10 text-amber-400",
    info: "bg-cyan-500/10 text-cyan-300",
  };
  return <span title={title} className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-(--color-border) py-12 px-4 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-(--color-muted) mt-1">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-(--color-muted) mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Status dot: online (green, pulsing), working (cyan), idle (amber), offline (gray). */
export function StatusDot({ status }: { status: string }) {
  const color =
    status === "online" ? "bg-emerald-400" :
    status === "working" ? "bg-cyan-400" :
    status === "idle" ? "bg-amber-400" : "bg-zinc-600";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color, status === "online" && "live-dot")} />;
}
