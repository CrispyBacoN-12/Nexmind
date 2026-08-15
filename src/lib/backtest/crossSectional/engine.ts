// The cross-sectional portfolio loop. Walks a shared trading-day calendar, ranks
// every eligible symbol each day, and holds the top N. This is the piece the
// single-symbol engine (backtest/engine.ts) cannot express: it holds one position
// at a time and has no notion of choosing between symbols.
//
// Fidelity rules, all deliberate:
// - Signals read bar t; entries fill at the open of t+1. Entering at the signal
//   close would be lookahead and would inflate every result.
// - Scheduled exits are decided at a close and fill at the next open.
// - Stops are intraday. A gap through the stop fills at the open, not the stop.
// - When candidates outnumber free slots, selection is strictly by rank, ties
//   broken by symbol, so runs are reproducible.
import type { Candle } from "@/lib/indicators";
import { alignUniverse } from "./calendar";
import { buildSeries, isEligible, rankScore, type SymbolSeries } from "./signals";
import { summarizeCrossSectional } from "./summary";
import type { CsConfig, CsResult, CsTrade, EquityPoint, ExitReason } from "./types";

const SPY_SMA_SLOPE_LOOKBACK = 10;

interface OpenPos {
  symbol: string;
  entryT: number;
  entryPrice: number; // cost-adjusted
  rawEntry: number; // pre-cost, for notional/commission
  shares: number;
  allocated: number;
  stop: number | null;
  riskPerShare: number | null;
  barsHeld: number;
  exitQueued: ExitReason | null; // decided at a close, filled at the next open
}

const bps = (v: number | undefined) => (v ?? 0) / 10_000;

/** Is the market-wide switch on for opening positions on day `key`? */
function regimeOpen(cfg: CsConfig, spy: SymbolSeries | undefined, spyIdx: number | undefined): boolean {
  if (cfg.regime === "off") return true;
  if (!spy || spyIdx == null) return false; // no regime data = stay flat, the safe default

  if (cfg.regime === "spySma200") {
    const s200 = spy.sma200[spyIdx];
    return s200 != null && spy.candles[spyIdx].c > s200;
  }

  // spySlope: SPY's own SMA200 must be rising over the last 10 bars. This mirrors
  // the higher-timeframe alignment that proved to be the real lever on gold.
  const now = spy.sma200[spyIdx];
  const then = spy.sma200[spyIdx - SPY_SMA_SLOPE_LOOKBACK];
  return now != null && then != null && now > then;
}

export function crossSectionalBacktest(bars: Map<string, Candle[]>, cfg: CsConfig): CsResult {
  const aligned = alignUniverse(bars);
  const seriesBySymbol = new Map<string, SymbolSeries>();
  for (const [symbol, candles] of bars) seriesBySymbol.set(symbol, buildSeries(candles));

  const spy = seriesBySymbol.get(cfg.regimeSymbol);
  const tradable = [...bars.keys()].filter((s) => s !== cfg.regimeSymbol).sort();

  const trades: CsTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const open = new Map<string, OpenPos>();
  let cash = cfg.capital;
  let pending: string[] = []; // symbols queued yesterday, to fill at today's open

  const slipIn = 1 + bps(cfg.costs.slippageBps);
  const slipOut = 1 - bps(cfg.costs.slippageBps);
  const commission = bps(cfg.costs.commissionBps);

  const idxOf = (symbol: string, day: number) => aligned.index.get(symbol)?.get(day);

  /** Cash plus every open position valued at today's close. */
  const markToMarket = (day: number) => {
    let total = cash;
    for (const pos of open.values()) {
      const i = idxOf(pos.symbol, day);
      total += i == null ? pos.allocated : seriesBySymbol.get(pos.symbol)!.candles[i].c * pos.shares;
    }
    return total;
  };

  const closeTrade = (pos: OpenPos, day: number, price: number, reason: ExitReason) => {
    const exitPrice = price * slipOut;
    const gross = (price - pos.rawEntry) * pos.shares;
    const commissionUsd = pos.rawEntry * pos.shares * commission;
    const net = (exitPrice - pos.entryPrice) * pos.shares - commissionUsd;
    cash += pos.allocated + net;
    trades.push({
      symbol: pos.symbol,
      entryT: pos.entryT,
      exitT: day * 86_400,
      entry: pos.entryPrice,
      exit: exitPrice,
      shares: pos.shares,
      grossPnl: gross,
      pnl: net,
      retPct: pos.allocated > 0 ? (net / pos.allocated) * 100 : 0,
      rMultiple: pos.riskPerShare && pos.riskPerShare > 0 ? net / (pos.riskPerShare * pos.shares) : null,
      reason,
      daysHeld: pos.barsHeld,
    });
    open.delete(pos.symbol);
  };

  for (let d = 0; d < aligned.days.length; d++) {
    const day = aligned.days[d];
    const isLastDay = d === aligned.days.length - 1;

    // --- 1. Fill exits queued at yesterday's close, at today's open ---
    for (const pos of [...open.values()]) {
      if (!pos.exitQueued) continue;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue; // no bar today (halt); try again tomorrow
      closeTrade(pos, day, seriesBySymbol.get(pos.symbol)!.candles[i].o, pos.exitQueued);
    }

    // --- 2. Fill entries queued at yesterday's close, at today's open ---
    // Size off total equity, not cash. Sizing off cash would shrink each
    // successive allocation geometrically as the book fills up, so the fifth
    // slot would get a fraction of the first — silently un-equal weighting.
    const equityForSizing = markToMarket(day);
    for (const symbol of pending) {
      if (open.size >= cfg.slots || open.has(symbol)) continue;
      const s = seriesBySymbol.get(symbol);
      const i = idxOf(symbol, day);
      if (!s || i == null) continue;

      const allocated = equityForSizing / cfg.slots;
      if (allocated <= 0 || allocated > cash) continue; // never allocate cash we don't hold

      const raw = s.candles[i].o;
      const fill = raw * slipIn;
      if (fill <= 0) continue;

      const a = s.atr[i];
      const riskPerShare = cfg.stopAtrMult != null && a != null ? cfg.stopAtrMult * a : null;

      const shares = allocated / fill;
      cash -= allocated;
      open.set(symbol, {
        symbol,
        entryT: day * 86_400,
        entryPrice: fill,
        rawEntry: raw,
        shares,
        allocated,
        stop: riskPerShare != null ? fill - riskPerShare : null,
        riskPerShare,
        barsHeld: 0,
        exitQueued: null,
      });
    }
    pending = [];

    // --- 3. Intraday stops on positions held through today ---
    for (const pos of [...open.values()]) {
      if (pos.stop == null) continue;
      const s = seriesBySymbol.get(pos.symbol)!;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue;
      const bar = s.candles[i];
      if (bar.l <= pos.stop) {
        // A gap through the stop fills at the open — an honest bad fill.
        closeTrade(pos, day, Math.min(bar.o, pos.stop), "stop");
      }
    }

    // --- 4. Age positions and queue scheduled exits at today's close ---
    for (const pos of open.values()) {
      const s = seriesBySymbol.get(pos.symbol)!;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue;
      pos.barsHeld += 1;

      if (pos.barsHeld >= cfg.holdDays) {
        pos.exitQueued = "hold-expiry";
        continue;
      }
      if (cfg.exitOnSma5) {
        const s5 = s.sma5[i];
        if (s5 != null && s.candles[i].c > s5) pos.exitQueued = "sma5";
      }
    }

    // --- 5. Rank today's eligible set and queue tomorrow's entries ---
    const freeSlots = cfg.slots - open.size;
    if (!isLastDay && freeSlots > 0 && regimeOpen(cfg, spy, spy ? idxOf(cfg.regimeSymbol, day) : undefined)) {
      const candidates: { symbol: string; score: number }[] = [];
      for (const symbol of tradable) {
        if (open.has(symbol)) continue;
        const s = seriesBySymbol.get(symbol)!;
        const i = idxOf(symbol, day);
        if (i == null || !isEligible(s, i, cfg)) continue;
        const score = rankScore(s, i, cfg);
        if (score == null) continue;
        // Rank order alone would buy the least-rising stock on a day when
        // nothing fell. Require a real decline before anything is a candidate.
        if (cfg.maxRankScore != null && score > cfg.maxRankScore) continue;
        candidates.push({ symbol, score });
      }
      candidates.sort((a, b) => (a.score === b.score ? a.symbol.localeCompare(b.symbol) : a.score - b.score));
      pending = candidates.slice(0, freeSlots).map((c) => c.symbol);
    }

    // --- 6. Mark to market ---
    equityCurve.push({ t: day * 86_400, equity: markToMarket(day), positions: open.size });

    // --- 7. Force-close anything still open on the final day ---
    if (isLastDay) {
      for (const pos of [...open.values()]) {
        const s = seriesBySymbol.get(pos.symbol)!;
        const i = idxOf(pos.symbol, day);
        if (i == null) continue;
        closeTrade(pos, day, s.candles[i].c, "end-of-data");
      }
    }
  }

  return { trades, equityCurve, summary: summarizeCrossSectional(trades, equityCurve, cfg.capital) };
}
