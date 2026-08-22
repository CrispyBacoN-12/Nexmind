"use client";

import { useState } from "react";
import { Card, CardTitle, Button, Badge, PageHeader, Empty } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";
import ResearchPanel from "@/components/research/ResearchPanel";

interface Row {
  symbol: string;
  strategy?: string;
  interval: string;
  range: string;
  adxFloor: number;
  rsiLow: number;
  rsiHigh: number;
  bars?: number;
  signals?: number;
  trades?: number;
  wins?: number;
  losses?: number;
  winRate?: number;
  totalPnl?: number;
  avgR?: number | null;
  expectancy?: number | null;
  error?: string;
}

const SYMBOLS = ["AAPL", "MSFT"];

// The two comparison matrices the lab can run.
const TIMEFRAME_CONFIGS = [
  { interval: "15m", range: "5d" },
  { interval: "1h", range: "3mo" },
  { interval: "1d", range: "1y" },
];
const ADX_CONFIGS = [15, 20, 25].map((adxFloor) => ({ interval: "1h", range: "3mo", adxFloor }));
// Compare entry strategies head-to-head on the same 1h timeframe.
const STRATEGY_CONFIGS = [
  { interval: "1h", range: "3mo" }, // no strategy key → built-in trend-pullback
  { interval: "1h", range: "3mo", strategy: "ema-cross" },
  { interval: "1h", range: "3mo", strategy: "orb" },
  { interval: "1h", range: "3mo", strategy: "fvg" },
];
// Combined vs the best single strategies, same 1h timeframe.
const COMBO_CONFIGS = [
  { interval: "1h", range: "3mo", strategy: "trend-pullback" },
  { interval: "1h", range: "3mo", strategy: "combo-or" },
  { interval: "1h", range: "3mo", strategy: "combo-vote" },
];
// Chart-pattern / OHLCV-only strategies on gold intraday (no RSI/MACD/ADX).
const CHART_GOLD_CONFIGS = [
  { interval: "5m",  range: "1mo", strategy: "trend-pullback" },
  { interval: "5m",  range: "1mo", strategy: "bull-flag" },
  { interval: "5m",  range: "1mo", strategy: "vol-spike" },
  { interval: "15m", range: "1mo", strategy: "trend-pullback" },
  { interval: "15m", range: "1mo", strategy: "bull-flag" },
  { interval: "15m", range: "1mo", strategy: "vol-spike" },
];
// Candlestick reversal patterns (pure OHLCV, trend-filtered) — same 1h
// timeframe as the strategy/combo comparisons above.
const CANDLESTICK_CONFIGS = [
  { interval: "1h", range: "3mo", strategy: "hammer" },
  { interval: "1h", range: "3mo", strategy: "shooting-star" },
  { interval: "1h", range: "3mo", strategy: "bullish-engulfing" },
  { interval: "1h", range: "3mo", strategy: "bearish-engulfing" },
  { interval: "1h", range: "3mo", strategy: "piercing-line" },
  { interval: "1h", range: "3mo", strategy: "dark-cloud-cover" },
  { interval: "1h", range: "3mo", strategy: "morning-star" },
  { interval: "1h", range: "3mo", strategy: "evening-star" },
  { interval: "1h", range: "3mo", strategy: "three-white-soldiers" },
  { interval: "1h", range: "3mo", strategy: "three-black-crows" },
  { interval: "1h", range: "3mo", strategy: "candlestick-any" },
];

function pnlColor(n: number | null | undefined): string {
  if (n == null) return "";
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-rose-400";
  return "";
}

export default function BacktestLab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [ran, setRan] = useState(false);

  async function run(mode: "timeframe" | "adx" | "strategy" | "combo" | "chart" | "candlestick") {
    setBusy(mode);
    setRan(true);
    try {
      const configs =
        mode === "timeframe" ? TIMEFRAME_CONFIGS
        : mode === "adx" ? ADX_CONFIGS
        : mode === "strategy" ? STRATEGY_CONFIGS
        : mode === "chart" ? CHART_GOLD_CONFIGS
        : mode === "candlestick" ? CANDLESTICK_CONFIGS
        : COMBO_CONFIGS;
      const symbols = mode === "chart" ? ["AAPL"] : SYMBOLS;
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, configs }),
      });
      const data = await res.json();
      setRows(data.results ?? []);
    } finally {
      setBusy("");
    }
  }

  // Best row per symbol by total P&L — highlighted in the table.
  const bestKey = new Map<string, number>();
  for (const r of rows) {
    if (r.error || r.totalPnl == null) continue;
    const cur = bestKey.get(r.symbol);
    if (cur == null || r.totalPnl > cur) bestKey.set(r.symbol, r.totalPnl);
  }

  return (
    <div>
      <PageHeader
        title="Backtest Lab"
        description="Replay the rule-based strategy over history to compare timeframes and entry thresholds — no AI, no cost."
        action={<Badge tone="info">PAPER · RULES ONLY</Badge>}
      />

      <ResearchPanel />

      <Card className="mb-5">
        <CardTitle>Run a comparison</CardTitle>
        <p className="text-xs text-(--color-muted) mb-3">AAPL + MSFT. Pick what to vary.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run("timeframe")} disabled={!!busy}>
            {busy === "timeframe" ? "Running…" : "Compare timeframes (15m / 1h / 1d)"}
          </Button>
          <Button variant="outline" onClick={() => run("adx")} disabled={!!busy}>
            {busy === "adx" ? "Running…" : "Sweep ADX floor (15 / 20 / 25)"}
          </Button>
          <Button variant="outline" onClick={() => run("strategy")} disabled={!!busy}>
            {busy === "strategy" ? "Running…" : "Compare strategies (1h)"}
          </Button>
          <Button variant="outline" onClick={() => run("combo")} disabled={!!busy}>
            {busy === "combo" ? "Running…" : "Combined (OR / Vote)"}
          </Button>
          <Button variant="outline" onClick={() => run("chart")} disabled={!!busy}>
            {busy === "chart" ? "Running…" : "Chart patterns — Gold 5m/15m"}
          </Button>
          <Button variant="outline" onClick={() => run("candlestick")} disabled={!!busy}>
            {busy === "candlestick" ? "Running…" : "Candlestick patterns (1h)"}
          </Button>
        </div>
        {busy && <p className="mt-2 text-xs text-(--color-muted)">Fetching candles and replaying the strategy…</p>}
      </Card>

      {rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <CardTitle>Results</CardTitle>
          <p className="text-xs text-(--color-muted) mb-3">Highlighted = best total P/L for that symbol.</p>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-(--color-muted) border-b border-(--color-border)">
                <th className="text-left py-1 pr-3">Symbol</th>
                <th className="text-left py-1 pr-3">Strategy</th>
                <th className="text-left py-1 pr-3">Timeframe</th>
                <th className="text-right py-1 pr-3">ADX≥</th>
                <th className="text-right py-1 pr-3">RSI</th>
                <th className="text-right py-1 pr-3">Signals</th>
                <th className="text-right py-1 pr-3">Trades</th>
                <th className="text-right py-1 pr-3">Win%</th>
                <th className="text-right py-1 pr-3">Avg R</th>
                <th className="text-right py-1 pr-3">Expectancy</th>
                <th className="text-right py-1">Total P/L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const best = !r.error && r.totalPnl != null && bestKey.get(r.symbol) === r.totalPnl;
                return (
                  <tr key={i} className={`border-b border-(--color-border)/50 ${best ? "bg-(--color-accent)/10" : ""}`}>
                    <td className="py-1 pr-3 font-semibold">{r.symbol}</td>
                    <td className="py-1 pr-3 text-(--color-muted)">{r.strategy ?? "—"}</td>
                    <td className="py-1 pr-3">{r.interval} / {r.range}</td>
                    <td className="py-1 pr-3 text-right">{r.adxFloor}</td>
                    <td className="py-1 pr-3 text-right text-(--color-muted)">{r.rsiLow}–{r.rsiHigh}</td>
                    {r.error ? (
                      <td className="py-1 text-rose-400" colSpan={6}>{r.error}</td>
                    ) : (
                      <>
                        <td className="py-1 pr-3 text-right text-(--color-muted)">{r.signals}</td>
                        <td className="py-1 pr-3 text-right">{r.trades}</td>
                        <td className="py-1 pr-3 text-right">{fmtNumber(r.winRate ?? 0, 0)}%</td>
                        <td className="py-1 pr-3 text-right">{r.avgR == null ? "—" : fmtNumber(r.avgR, 2)}</td>
                        <td className={`py-1 pr-3 text-right ${pnlColor(r.expectancy)}`}>{r.expectancy == null ? "—" : fmtNumber(r.expectancy, 2)}</td>
                        <td className={`py-1 text-right font-semibold ${pnlColor(r.totalPnl)}`}>{fmtNumber(r.totalPnl ?? 0, 2)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        ran && !busy && <Empty title="No results" hint="Try another comparison." />
      )}
    </div>
  );
}
