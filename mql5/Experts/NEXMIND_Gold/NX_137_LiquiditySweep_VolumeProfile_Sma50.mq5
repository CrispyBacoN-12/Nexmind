//+------------------------------------------------------------------+
//| NX_137_LiquiditySweep_VolumeProfile_Sma50.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #137 PROPOSED 1h GC=F (run 77): trades 34, win 41.2%, avgR -, PF 1.65
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Original was a TradingView Pine v5 strategy stored in ResearchStrategy.code.
//| Exit defaults: SL 2.0 x ATR, ATR trail 1.0/1.75.
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Liquidity Sweep + Volume Profile + SMA50 (Long Only, ATR Trail)"

#define NX_NAME "Liquidity Sweep + Volume Profile + SMA50 (Long Only, ATR Tra"
#define NX_MAGIC 7700137
#define NX_SL_MULT 2.0
#define NX_USE_TRAIL true
#define NX_TRAIL_ACTIVATE 1.0
#define NX_TRAIL_OFFSET 1.75
#define NX_DIRECTION 1
#include "NexCore.mqh"

input group "Sweep / volume profile (Pine defaults)"
input int    InpLookback = 20;              // Lookback bars (sweep level + profile window)
input bool   InpUseVolumeFilter = true;     // Require volume spike on sweep bar
input double InpVolSpikeMult = 1.5;         // Volume spike multiple of prior-N average
input bool   InpUseValueAreaFilter = true;  // Swept level must be outside the value area
input int    InpNumBins = 24;               // Volume profile price bins
input double InpValueAreaPct = 0.70;        // Value area share of volume
input bool   InpUseSma50Filter = true;      // Close vs SMA50 trend filter

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   int lb = InpLookback;
   if(i < lb + 1) return NX_NONE;
   NexBar c = bars[i];
   double hi = -DBL_MAX, lo = DBL_MAX, volSum = 0;
   for(int k = i - lb; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; volSum += bars[k].v; }
   bool rawLong = c.l < lo && c.c > lo;
   bool rawShort = c.h > hi && c.c < hi;
   if(!rawLong && !rawShort) return NX_NONE;
   // volume spike vs the average of the prior lb bars
   bool passVolume = !InpUseVolumeFilter || c.v > (volSum / lb) * InpVolSpikeMult;
   // rolling volume profile over the last lb bars INCLUDING this one (Pine: ta.highest(high, lookback))
   double pH = -DBL_MAX, pL = DBL_MAX;
   for(int k = i - lb + 1; k <= i; k++) { if(bars[k].h > pH) pH = bars[k].h; if(bars[k].l < pL) pL = bars[k].l; }
   int nb = InpNumBins;
   double binSize = (pH - pL) / nb;
   bool passVA = !InpUseValueAreaFilter;
   if(InpUseValueAreaFilter && binSize > 0)
     {
      double bins[];
      ArrayResize(bins, nb);
      ArrayInitialize(bins, 0);
      for(int k = 0; k < lb; k++)
        {
         NexBar b = bars[i - k];
         double tp = (b.h + b.l + b.c) / 3;
         int idx = (int)MathMin(nb - 1, MathMax(0, MathFloor((tp - pL) / binSize)));
         bins[idx] += b.v;
        }
      int poc = 0;
      double maxVol = bins[0], total = 0;
      for(int b = 1; b < nb; b++) if(bins[b] > maxVol) { maxVol = bins[b]; poc = b; }
      for(int b = 0; b < nb; b++) total += bins[b];
      double vaVol = maxVol;
      int loIdx = poc, hiIdx = poc, iter = 0;
      while(vaVol < total * InpValueAreaPct && (loIdx > 0 || hiIdx < nb - 1) && iter < nb)
        {
         double below = loIdx > 0 ? bins[loIdx - 1] : -1.0;
         double above = hiIdx < nb - 1 ? bins[hiIdx + 1] : -1.0;
         if(above >= below && hiIdx < nb - 1) { hiIdx++; vaVol += bins[hiIdx]; }
         else if(loIdx > 0) { loIdx--; vaVol += bins[loIdx]; }
         iter++;
        }
      double vah = pL + (hiIdx + 1) * binSize, val = pL + loIdx * binSize;
      passVA = rawLong ? lo < val : hi > vah;
     }
   NexSnap s = snaps[i];
   bool passSma = !InpUseSma50Filter || (!NA(s.sma50) && (rawLong ? c.c > s.sma50 : c.c < s.sma50));
   if(!(passVolume && passVA && passSma)) return NX_NONE;
   note = rawLong ? "sweep below " + IntegerToString(lb) + "-bar low, volume spike, outside value area" : "sweep above " + IntegerToString(lb) + "-bar high, volume spike, outside value area";
   return rawLong ? NX_LONG : NX_SHORT;
  }
//+------------------------------------------------------------------+
