//+------------------------------------------------------------------+
//| NX_107_MacdMomentum_Sma50Adx.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #107 REJECTED 1d GC=F (run 67): trades 2, win 100.0%, avgR 0.799, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "MACD Momentum Continuation (SMA50 trend + ADX filter)"

#define NX_NAME "MACD Momentum Continuation (SMA50 trend + ADX filter)"
#define NX_MAGIC 7700107
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 50) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.macdHist) || NA(p.macdHist) || NA(s.sma50) || NA(s.adx) || NA(p.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(p.plusDI) || NA(p.minusDI) || NA(s.rsi) || NA(s.atr)) return NX_NONE;
   double c = bars[i].c;
   bool cu = p.macdHist <= 0 && s.macdHist > 0;
   bool cd = p.macdHist >= 0 && s.macdHist < 0;
   bool histMoveOk = MathAbs(s.macdHist - p.macdHist) > 0.03 * s.atr;
   bool diBull = s.plusDI > s.minusDI && p.plusDI > p.minusDI;
   bool diBear = s.minusDI > s.plusDI && p.minusDI > p.plusDI;
   bool adxOk = s.adx > 12;
   if(cu && histMoveOk && c > s.sma50 && adxOk && diBull && s.rsi > 38 && s.rsi < 75) { note = "MACD hist cross up above SMA50"; return NX_LONG; }
   if(cd && histMoveOk && c < s.sma50 && adxOk && diBear && s.rsi < 62 && s.rsi > 25) { note = "MACD hist cross down below SMA50"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
