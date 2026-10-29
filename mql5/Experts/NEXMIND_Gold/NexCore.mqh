//+------------------------------------------------------------------+
//| NexCore.mqh - shared engine for the NEXMIND gold strategy EAs     |
//|                                                                  |
//| Ports, line for line, the parts of the TypeScript repo that the  |
//| research strategies were backtested against:                     |
//|   src/lib/indicators.ts           sma/ema/rsi/macd/bollinger/    |
//|                                   stochastic/atr/adx/VWAP        |
//|   src/lib/research/adapter.ts     computeSnapshots()             |
//|   src/lib/trading/positionRules.ts  single-target ladder + trail |
//|                                                                  |
//| Each EA in this folder defines NexDecide(), which is the |
//| strategy's original JavaScript entry rule translated to MQL5, and |
//| may #define the NX_* defaults below before including this file.   |
//|                                                                  |
//| Differences from the TypeScript backtester, all deliberate:      |
//|  - Entry fills at market on the first tick of the bar AFTER the  |
//|    signal bar. The TS engine booked the signal bar's close, which |
//|    nobody can trade at. SL/TP distances are measured from the     |
//|    real fill price, using the signal bar's ATR.                   |
//|  - Indicators are recomputed over the last InpHistoryBars closed |
//|    bars, not the whole history. Wilder smoothing converges long  |
//|    before 1500 bars, so the values match to many decimals.       |
//|  - Volume is MT5 tick volume unless real volume exists. Yahoo's  |
//|    GC=F volume was futures volume, so volume rules will differ.  |
//|  - Times are converted to UTC with InpServerGMTOffset. Exness    |
//|    servers run at GMT+0; most other brokers run at GMT+2/+3.     |
//+------------------------------------------------------------------+
#property strict

//--- per-EA defaults (an EA may #define these before the #include)
#ifndef NX_NAME
   #define NX_NAME "NEXMIND strategy"
#endif
#ifndef NX_SL_MULT
   #define NX_SL_MULT 1.5      // engine: stop = 1.5 x ATR14
#endif
#ifndef NX_TP_MULT
   #define NX_TP_MULT 1.2      // legacy research ladder: single target at 1.2 x ATR14
#endif
#ifndef NX_USE_TRAIL
   #define NX_USE_TRAIL false
#endif
#ifndef NX_TRAIL_ACTIVATE
   #define NX_TRAIL_ACTIVATE 1.5
#endif
#ifndef NX_TRAIL_OFFSET
   #define NX_TRAIL_OFFSET 1.5
#endif
#ifndef NX_DIRECTION
   #define NX_DIRECTION 0      // 0 = long & short, 1 = long only, 2 = short only
#endif
#ifndef NX_WEEKEND_FLAT
   #define NX_WEEKEND_FLAT false
#endif
#ifndef NX_MAGIC
   #define NX_MAGIC 7700000
#endif

//--- inputs
input group "Risk"
input double InpLots            = 0.01;   // Fixed lot (used when risk % is 0)
input double InpRiskPercent     = 0.0;    // Risk % of equity per trade (0 = fixed lot)
input group "Exit (ATR multiples, ATR14 of the signal bar)"
input double InpSLMult          = NX_SL_MULT;        // Stop loss x ATR
input double InpTPMult          = NX_TP_MULT;        // Take profit x ATR (ignored when trailing)
input bool   InpUseTrail        = NX_USE_TRAIL;      // Use ATR trailing stop instead of TP
input double InpTrailActivate   = NX_TRAIL_ACTIVATE; // Trail arms after price moves this x ATR
input double InpTrailOffset     = NX_TRAIL_OFFSET;   // Trail distance behind best price x ATR
input group "Filters"
input int    InpDirection       = NX_DIRECTION;      // 0 both, 1 long only, 2 short only
input bool   InpWeekendFlat     = NX_WEEKEND_FLAT;   // Flatten before Fri 21:00 UTC, no entries until Sun 22:00 UTC
input int    InpFlatMinutesBefore = 15;              // Minutes before Fri 21:00 UTC to flatten
input group "Data"
input int    InpServerGMTOffset = 0;      // Broker server time minus UTC, hours (Exness = 0)
input int    InpHistoryBars     = 1500;   // Closed bars used for indicators
input bool   InpUseRealVolume   = false;  // Use real volume instead of tick volume (if broker has it)
input group "Misc"
input long   InpMagic           = NX_MAGIC;
input bool   InpLogSignals      = true;

//--- data types --------------------------------------------------------
#define NX_NA EMPTY_VALUE
bool NA(const double v) { return v == NX_NA; }

struct NexBar
  {
   long   t;          // bar open time, UTC seconds (same as Candle.t in the TS repo)
   double o, h, l, c, v;
  };

struct NexSnap
  {
   double price, sma20, sma50, rsi, adx, plusDI, minusDI, macdHist, atr;
   double bbPercentB, bbWidth, stochK, stochD, vwapDevPct;
  };

#define NX_LONG   1
#define NX_SHORT -1
#define NX_NONE   0

//--- implemented by each EA: the strategy's entry rule.
//--- bars[]/snaps[] run oldest -> newest and i is the last CLOSED bar,
//--- exactly like the JS sandbox (bars.length - 1 == i).
int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note);

//--- small helpers used by the translated rules ------------------------
int    NxUtcHour(const long t)    { MqlDateTime d; TimeToStruct((datetime)t, d); return d.hour; }
int    NxUtcWeekday(const long t) { MqlDateTime d; TimeToStruct((datetime)t, d); return d.day_of_week; }
string NxF(const double v, const int digits) { return DoubleToString(v, digits); }

//=======================================================================
// Indicators - ports of src/lib/indicators.ts. Output arrays are aligned
// with the input and hold NX_NA where the TS version returns null.
//=======================================================================
void NxFillNA(double &out[], const int n) { ArrayResize(out, n); ArrayInitialize(out, NX_NA); }

void NxSma(const double &v[], const int n, const int period, double &out[])
  {
   NxFillNA(out, n);
   if(period <= 0 || n < period) return;
   double sum = 0;
   for(int i = 0; i < period; i++) sum += v[i];
   out[period - 1] = sum / period;
   for(int i = period; i < n; i++) { sum += v[i] - v[i - period]; out[i] = sum / period; }
  }

void NxEma(const double &v[], const int n, const int period, double &out[])
  {
   NxFillNA(out, n);
   if(period <= 0 || n < period) return;
   double k = 2.0 / (period + 1), seed = 0;
   for(int i = 0; i < period; i++) seed += v[i];
   double prev = seed / period;
   out[period - 1] = prev;
   for(int i = period; i < n; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  }

void NxRsi(const double &v[], const int n, const int period, double &out[])
  {
   NxFillNA(out, n);
   if(n < period + 1) return;
   double gain = 0, loss = 0;
   for(int i = 1; i <= period; i++)
     {
      double d = v[i] - v[i - 1];
      if(d > 0) gain += d; else loss -= d;
     }
   gain /= period; loss /= period;
   out[period] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
   for(int i = period + 1; i < n; i++)
     {
      double d = v[i] - v[i - 1];
      double g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
     }
  }

void NxMacdHist(const double &v[], const int n, double &hist[])
  {
   double ef[], es[], line[];
   NxEma(v, n, 12, ef);
   NxEma(v, n, 26, es);
   NxFillNA(line, n);
   NxFillNA(hist, n);
   int first = -1;
   for(int i = 0; i < n; i++)
      if(!NA(ef[i]) && !NA(es[i])) { line[i] = ef[i] - es[i]; if(first < 0) first = i; }
   if(first < 0) return;
   // TS: ema() over the non-null tail of the MACD line, re-aligned at `first`
   int m = n - first;
   double tail[], sig[];
   ArrayResize(tail, m);
   for(int i = 0; i < m; i++) tail[i] = line[first + i];
   NxEma(tail, m, 9, sig);
   for(int i = 0; i < m; i++)
      if(!NA(sig[i])) hist[first + i] = line[first + i] - sig[i];
  }

void NxBollinger(const double &v[], const int n, const int period, const double mult,
                 double &up[], double &mid[], double &lo[])
  {
   NxSma(v, n, period, mid);
   NxFillNA(up, n);
   NxFillNA(lo, n);
   for(int i = period - 1; i < n; i++)
     {
      double m = mid[i], sq = 0;
      for(int j = i - period + 1; j <= i; j++) sq += (v[j] - m) * (v[j] - m);
      double sd = MathSqrt(sq / period);
      up[i] = m + mult * sd;
      lo[i] = m - mult * sd;
     }
  }

void NxSmoothSeries(const double &s[], const int n, const int p, double &out[])
  {
   NxFillNA(out, n);
   for(int i = p - 1; i < n; i++)
     {
      double sum = 0; bool ok = true;
      for(int j = i - p + 1; j <= i; j++) { if(NA(s[j])) { ok = false; break; } sum += s[j]; }
      if(ok) out[i] = sum / p;
     }
  }

void NxStochastic(const NexBar &b[], const int n, const int period, const int sk, const int sd,
                  double &k[], double &d[])
  {
   double raw[];
   NxFillNA(raw, n);
   for(int i = period - 1; i < n; i++)
     {
      double hh = -DBL_MAX, ll = DBL_MAX;
      for(int j = i - period + 1; j <= i; j++) { if(b[j].h > hh) hh = b[j].h; if(b[j].l < ll) ll = b[j].l; }
      double r = hh - ll;
      raw[i] = r == 0 ? 50 : 100 * (b[i].c - ll) / r;
     }
   NxSmoothSeries(raw, n, sk, k);
   NxSmoothSeries(k, n, sd, d);
  }

void NxTrueRange(const NexBar &b[], const int n, double &tr[])
  {
   ArrayResize(tr, n);
   for(int i = 0; i < n; i++)
     {
      if(i == 0) { tr[i] = b[i].h - b[i].l; continue; }
      double pc = b[i - 1].c;
      tr[i] = MathMax(b[i].h - b[i].l, MathMax(MathAbs(b[i].h - pc), MathAbs(b[i].l - pc)));
     }
  }

void NxAtr(const NexBar &b[], const int n, const int period, double &out[])
  {
   NxFillNA(out, n);
   if(n < period + 1) return;
   double tr[];
   NxTrueRange(b, n, tr);
   double sum = 0;
   for(int i = 1; i <= period; i++) sum += tr[i];
   double prev = sum / period;
   out[period] = prev;
   for(int i = period + 1; i < n; i++) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
  }

void NxAdx(const NexBar &b[], const int n, const int period, double &adx[], double &pdi[], double &mdi[])
  {
   NxFillNA(adx, n); NxFillNA(pdi, n); NxFillNA(mdi, n);
   if(n < period * 2) return;
   double tr[], pdm[], mdm[], dx[];
   NxTrueRange(b, n, tr);
   ArrayResize(pdm, n); ArrayInitialize(pdm, 0);
   ArrayResize(mdm, n); ArrayInitialize(mdm, 0);
   ArrayResize(dx, n);  ArrayInitialize(dx, 0);
   for(int i = 1; i < n; i++)
     {
      double up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
      pdm[i] = (up > dn && up > 0) ? up : 0;
      mdm[i] = (dn > up && dn > 0) ? dn : 0;
     }
   double trS = 0, pS = 0, mS = 0;
   for(int i = 1; i <= period; i++) { trS += tr[i]; pS += pdm[i]; mS += mdm[i]; }
   for(int i = period; i < n; i++)
     {
      if(i > period) { trS = trS - trS / period + tr[i]; pS = pS - pS / period + pdm[i]; mS = mS - mS / period + mdm[i]; }
      double p = trS == 0 ? 0 : 100 * pS / trS;
      double m = trS == 0 ? 0 : 100 * mS / trS;
      pdi[i] = p; mdi[i] = m;
      double den = p + m;
      dx[i] = den == 0 ? 0 : 100 * MathAbs(p - m) / den;
     }
   int start = period * 2 - 1;
   if(start >= n) return;
   double sdx = 0;
   for(int i = period; i <= start; i++) sdx += dx[i];
   double prev = sdx / period;
   adx[start] = prev;
   for(int i = start + 1; i < n; i++) { prev = (prev * (period - 1) + dx[i]) / period; adx[i] = prev; }
  }

//--- VWAP re-anchored every UTC day (adapter.ts uses dailyAnchor for research)
void NxDailyVwap(const NexBar &b[], const int n, double &out[])
  {
   NxFillNA(out, n);
   double pv = 0, vs = 0;
   for(int i = 0; i < n; i++)
     {
      if(i == 0 || (b[i].t / 86400) != (b[i - 1].t / 86400)) { pv = 0; vs = 0; }
      double typical = (b[i].h + b[i].l + b[i].c) / 3;
      pv += typical * b[i].v;
      vs += b[i].v;
      out[i] = vs > 0 ? pv / vs : NX_NA;
     }
  }

//--- adapter.ts computeSnapshots()
void NxComputeSnapshots(const NexBar &b[], const int n, NexSnap &s[])
  {
   double closes[];
   ArrayResize(closes, n);
   for(int i = 0; i < n; i++) closes[i] = b[i].c;
   double s20[], s50[], r[], hist[], atr[], adx[], pdi[], mdi[], bu[], bm[], bl[], k[], d[], vw[];
   NxSma(closes, n, 20, s20);
   NxSma(closes, n, 50, s50);
   NxRsi(closes, n, 14, r);
   NxMacdHist(closes, n, hist);
   NxAtr(b, n, 14, atr);
   NxAdx(b, n, 14, adx, pdi, mdi);
   NxBollinger(closes, n, 20, 2.0, bu, bm, bl);
   NxStochastic(b, n, 14, 3, 3, k, d);
   NxDailyVwap(b, n, vw);
   ArrayResize(s, n);
   for(int i = 0; i < n; i++)
     {
      s[i].price = b[i].c;
      s[i].sma20 = s20[i]; s[i].sma50 = s50[i]; s[i].rsi = r[i];
      s[i].adx = adx[i]; s[i].plusDI = pdi[i]; s[i].minusDI = mdi[i];
      s[i].macdHist = hist[i]; s[i].atr = atr[i];
      s[i].bbPercentB = (!NA(bu[i]) && !NA(bl[i]) && bu[i] != bl[i]) ? (b[i].c - bl[i]) / (bu[i] - bl[i]) : NX_NA;
      s[i].bbWidth    = (!NA(bu[i]) && !NA(bl[i]) && !NA(bm[i]) && bm[i] != 0) ? (bu[i] - bl[i]) / bm[i] : NX_NA;
      s[i].stochK = k[i]; s[i].stochD = d[i];
      s[i].vwapDevPct = (!NA(vw[i]) && vw[i] != 0) ? (b[i].c - vw[i]) / vw[i] : NX_NA;
     }
  }

//=======================================================================
// Trading
//=======================================================================
datetime g_lastBarTime = 0;
ulong    g_trailTicket = 0;
double   g_trailExtreme = 0;
double   g_trailActivateDist = 0, g_trailOffsetDist = 0;

bool NxLoadBars(NexBar &bars[], int &n)
  {
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int got = CopyRates(_Symbol, _Period, 1, InpHistoryBars, r);   // shift 1 = closed bars only
   if(got <= 0) return false;
   n = got;
   ArrayResize(bars, n);
   for(int i = 0; i < n; i++)
     {
      bars[i].t = (long)r[i].time - (long)InpServerGMTOffset * 3600;
      bars[i].o = r[i].open; bars[i].h = r[i].high; bars[i].l = r[i].low; bars[i].c = r[i].close;
      bars[i].v = (InpUseRealVolume && r[i].real_volume > 0) ? (double)r[i].real_volume : (double)r[i].tick_volume;
     }
   return true;
  }

bool NxSelectPosition()
  {
   for(int p = PositionsTotal() - 1; p >= 0; p--)
     {
      ulong tk = PositionGetTicket(p);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagic) return true;
     }
   return false;
  }

ENUM_ORDER_TYPE_FILLING NxFilling()
  {
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK) return ORDER_FILLING_FOK;
   if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
  }

double NxNormalizeLots(double lots)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step) * step;
   return MathMax(mn, MathMin(mx, lots));
  }

double NxLotsFor(const double slDist)
  {
   if(InpRiskPercent <= 0) return NxNormalizeLots(InpLots);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickSize <= 0 || tickValue <= 0 || slDist <= 0) return NxNormalizeLots(InpLots);
   double lossPerLot = slDist / tickSize * tickValue;
   return NxNormalizeLots(AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPercent / 100.0 / lossPerLot);
  }

bool NxSend(MqlTradeRequest &req)
  {
   MqlTradeResult res;
   ZeroMemory(res);
   if(!OrderSend(req, res) || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
     {
      PrintFormat("%s: order failed, retcode %u (%s)", NX_NAME, res.retcode, res.comment);
      return false;
     }
   return true;
  }

void NxClosePosition(const string why)
  {
   if(!NxSelectPosition()) return;
   MqlTradeRequest req;
   ZeroMemory(req);
   long type = PositionGetInteger(POSITION_TYPE);
   req.action = TRADE_ACTION_DEAL;
   req.position = (ulong)PositionGetInteger(POSITION_TICKET);
   req.symbol = _Symbol;
   req.volume = PositionGetDouble(POSITION_VOLUME);
   req.type = type == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price = type == POSITION_TYPE_BUY ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   req.deviation = 50;
   req.magic = InpMagic;
   req.type_filling = NxFilling();
   req.comment = why;
   NxSend(req);
  }

void NxOpen(const int side, const double atr, const string note)
  {
   if(atr <= 0 || NA(atr)) return;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double price = side == NX_LONG ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double slDist = InpSLMult * atr;
   double sl = side == NX_LONG ? price - slDist : price + slDist;
   double tp = 0;
   if(!InpUseTrail) tp = side == NX_LONG ? price + InpTPMult * atr : price - InpTPMult * atr;

   MqlTradeRequest req;
   ZeroMemory(req);
   req.action = TRADE_ACTION_DEAL;
   req.symbol = _Symbol;
   req.volume = NxLotsFor(slDist);
   req.type = side == NX_LONG ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price = price;
   req.sl = NormalizeDouble(sl, digits);
   req.tp = tp > 0 ? NormalizeDouble(tp, digits) : 0;
   req.deviation = 50;
   req.magic = InpMagic;
   req.type_filling = NxFilling();
   req.comment = StringSubstr(NX_NAME, 0, 31);
   if(NxSend(req))
     {
      g_trailTicket = 0;   // re-armed on the next tick from the position itself
      g_trailActivateDist = InpTrailActivate * atr;
      g_trailOffsetDist = InpTrailOffset * atr;
      if(InpLogSignals) PrintFormat("%s: %s at %s, SL %s, TP %s | %s", NX_NAME, side == NX_LONG ? "BUY" : "SELL",
                                    NxF(price, digits), NxF(sl, digits), tp > 0 ? NxF(tp, digits) : "trail", note);
     }
  }

//--- positionRules.ts decideTrailingAction(): fixed distances from entry ATR,
//--- trail arms after activateDist in favour, then sits offsetDist behind the best price.
void NxManageTrail()
  {
   if(!InpUseTrail || !NxSelectPosition()) return;
   ulong tk = (ulong)PositionGetInteger(POSITION_TICKET);
   long type = PositionGetInteger(POSITION_TYPE);
   double entry = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl = PositionGetDouble(POSITION_SL);
   if(tk != g_trailTicket)
     {
      // New position, or EA restarted: rebuild the best price since entry.
      g_trailTicket = tk;
      g_trailExtreme = entry;
      if(g_trailActivateDist <= 0 || g_trailOffsetDist <= 0)
        {
         // Restart: recover the entry ATR from the stop distance.
         double atr = MathAbs(entry - sl) / InpSLMult;
         g_trailActivateDist = InpTrailActivate * atr;
         g_trailOffsetDist = InpTrailOffset * atr;
        }
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      double hi[], lo[];
      if(type == POSITION_TYPE_BUY && CopyHigh(_Symbol, PERIOD_M1, opened, TimeCurrent(), hi) > 0) g_trailExtreme = MathMax(entry, hi[ArrayMaximum(hi)]);
      if(type == POSITION_TYPE_SELL && CopyLow(_Symbol, PERIOD_M1, opened, TimeCurrent(), lo) > 0) g_trailExtreme = MathMin(entry, lo[ArrayMinimum(lo)]);
     }
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double newSl = sl;
   if(type == POSITION_TYPE_BUY)
     {
      g_trailExtreme = MathMax(g_trailExtreme, SymbolInfoDouble(_Symbol, SYMBOL_BID));
      if(g_trailExtreme - entry >= g_trailActivateDist) newSl = MathMax(sl, g_trailExtreme - g_trailOffsetDist);
     }
   else
     {
      g_trailExtreme = MathMin(g_trailExtreme, SymbolInfoDouble(_Symbol, SYMBOL_ASK));
      if(entry - g_trailExtreme >= g_trailActivateDist) newSl = (sl == 0) ? g_trailExtreme + g_trailOffsetDist : MathMin(sl, g_trailExtreme + g_trailOffsetDist);
     }
   newSl = NormalizeDouble(newSl, digits);
   if(MathAbs(newSl - sl) < SymbolInfoDouble(_Symbol, SYMBOL_POINT)) return;
   MqlTradeRequest req;
   ZeroMemory(req);
   req.action = TRADE_ACTION_SLTP;
   req.position = tk;
   req.symbol = _Symbol;
   req.sl = newSl;
   req.tp = PositionGetDouble(POSITION_TP);
   req.magic = InpMagic;
   NxSend(req);
  }

//--- xau-v1 weekend rule (src/lib/gold/weekendFlat.ts): flat from Friday 21:00 UTC
//--- until Sunday 22:00 UTC. Brought forward by InpFlatMinutesBefore because most
//--- brokers stop quoting gold at or just before 21:00 UTC, so no bar exists then.
bool NxInWeekendWindow()
  {
   long now = (long)TimeCurrent() - (long)InpServerGMTOffset * 3600;
   MqlDateTime d;
   TimeToStruct((datetime)now, d);
   int mins = d.hour * 60 + d.min;
   if(d.day_of_week == 5) return mins >= 21 * 60 - InpFlatMinutesBefore;
   if(d.day_of_week == 6) return true;
   if(d.day_of_week == 0) return mins < 22 * 60;
   return false;
  }

int OnInit()
  {
   if(InpHistoryBars < 600) { Print(NX_NAME, ": InpHistoryBars must be at least 600"); return INIT_PARAMETERS_INCORRECT; }
   // Wait for the next bar to open. Acting on the bar that is already running
   // would enter mid-bar on a signal the backtest filled at that bar's open.
   g_lastBarTime = iTime(_Symbol, _Period, 0);
   return INIT_SUCCEEDED;
  }

void OnTick()
  {
   if(InpWeekendFlat && NxInWeekendWindow())
     {
      if(NxSelectPosition()) NxClosePosition("weekend flat");
      return;
     }
   NxManageTrail();

   datetime cur = iTime(_Symbol, _Period, 0);
   if(cur == 0 || cur == g_lastBarTime) return;
   g_lastBarTime = cur;

   if(NxSelectPosition()) return;   // one position per symbol, same as the TS engine

   NexBar bars[];
   NexSnap snaps[];
   int n = 0;
   if(!NxLoadBars(bars, n) || n < 600) return;
   NxComputeSnapshots(bars, n, snaps);

   string note = "";
   int side = NexDecide(bars, snaps, n - 1, note);
   if(side == NX_NONE) return;
   if(InpDirection == 1 && side != NX_LONG) return;
   if(InpDirection == 2 && side != NX_SHORT) return;
   NxOpen(side, snaps[n - 1].atr, note);
  }
//+------------------------------------------------------------------+
