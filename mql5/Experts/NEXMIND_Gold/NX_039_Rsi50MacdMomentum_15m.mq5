//+------------------------------------------------------------------+
//| NX_039_Rsi50MacdMomentum_15m.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #39 REJECTED 15m GC=F (run 18): trades 45, win 53.3%, avgR -0.448, PF 0.29
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "RSI-50 / MACD Momentum"

#define NX_NAME "RSI-50 / MACD Momentum"
#define NX_MAGIC 7700039
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 2) return NX_NONE;
   int localHour = (NxUtcHour(bars[i].t) + 7) % 24;   // the original rule's Bangkok-time window
   if(localHour < 7 || localHour >= 16) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.rsi) || NA(p.rsi) || NA(pp.rsi) || NA(s.macdHist) || NA(p.macdHist)) return NX_NONE;
   if(NA(s.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(s.sma50) || NA(s.atr)) return NX_NONE;
   if(s.adx < 20) return NX_NONE;
   bool rsiUp = s.rsi > 52 && s.rsi > p.rsi && p.rsi > pp.rsi;
   bool rsiDn = s.rsi < 48 && s.rsi < p.rsi && p.rsi < pp.rsi;
   bool macdUp = s.macdHist > 0 && s.macdHist > p.macdHist;
   bool macdDn = s.macdHist < 0 && s.macdHist < p.macdHist;
   bool diLong = s.plusDI > s.minusDI + 3, diShort = s.minusDI > s.plusDI + 3;
   if(rsiUp && macdUp && diLong && bars[i].c > s.sma50) { note = "RSI mom+ MACD+ +DI dom above SMA50, ADX " + NxF(s.adx, 1); return NX_LONG; }
   if(rsiDn && macdDn && diShort && bars[i].c < s.sma50) { note = "RSI mom- MACD- -DI dom below SMA50, ADX " + NxF(s.adx, 1); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
