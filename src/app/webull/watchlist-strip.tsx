"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtNumber, colorForChange } from "@/lib/utils";

interface Quote { symbol: string; price: number; prevClose: number; changePct: number }

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AMD"];

export function WatchlistStrip({ active, onSelect }: { active: string; onSelect: (symbol: string) => void }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/webull/quote?symbols=${DEFAULT_WATCHLIST.join(",")}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled && Array.isArray(data)) setQuotes(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {(loading ? DEFAULT_WATCHLIST.map((symbol) => ({ symbol, price: null, changePct: null })) : quotes).map((q) => (
        <button
          key={q.symbol}
          onClick={() => onSelect(q.symbol)}
          className={cn(
            "shrink-0 rounded-md border px-3 py-2 text-left transition min-w-[104px]",
            q.symbol === active
              ? "border-(--color-accent)/50 bg-(--color-accent)/10"
              : "border-(--color-border) bg-(--color-card) hover:bg-(--color-border)/30",
          )}
        >
          <div className="text-xs font-mono font-medium">{q.symbol}</div>
          <div className="text-sm font-mono tabular-nums mt-0.5">{q.price != null ? fmtNumber(q.price, 2) : "…"}</div>
          <div className={cn("text-[11px] font-mono tabular-nums", colorForChange(q.changePct))}>
            {q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${fmtNumber(q.changePct, 2)}%` : "—"}
          </div>
        </button>
      ))}
    </div>
  );
}
