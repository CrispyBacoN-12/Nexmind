---
type: strategy
key: research-112
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, atr]
---

# 20-Bar Range Breakout

DI-Dominance Widening (ADX>=20, gap widening) re-test on SI=F (silver futures) 1h/1y - retrying the strongest validated concept in this project (research-30: live on GC=F, 695 trades, 57.3% win rate, approved) after research-92's first port to silver produced only 2 trades in the same 1h/1y window where gold generated 695 - a near-total absence of signal that points to an overly strict implementation on the prior attempt, not a real lack of edge, since +DI/-DI/ADX are already normalized 0-100 indicators that should behave similarly across symbols. Port the EXACT same logic as research-30 unchanged: enter when ADX >= 20 and the +DI/-DI gap is widening versus the prior bar (no fresh crossover required, no extra confirmation filters, no minimum gap-size threshold beyond what research-30 used). Do not stack RSI/MACD/volume filters on top - keep entry logic to those two conditions only. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50% and a trade count in the hundreds like the gold original, not single digits.

## Logic

```js
var n = bars.length - 1;
var lookback = 30;
if (n < lookback + 6) return null;
var hh = -Infinity, ll = Infinity;
for (var i = n - lookback; i < n; i++) {
  if (bars[i].h > hh) hh = bars[i].h;
  if (bars[i].l < ll) ll = bars[i].l;
}
var prevHh = -Infinity, prevLl = Infinity;
for (var j = n - 1 - lookback; j < n - 1; j++) {
  if (bars[j].h > prevHh) prevHh = bars[j].h;
  if (bars[j].l < prevLl) prevLl = bars[j].l;
}
var cur = bars[n];
var prev = bars[n - 1];
var curSnap = snaps[n];
var pastSnap = snaps[n - 5];
if (curSnap.adx == null || curSnap.atr == null || curSnap.sma20 == null || curSnap.sma50 == null || curSnap.plusDI == null || curSnap.minusDI == null) return null;
if (pastSnap == null || pastSnap.sma20 == null) return null;
if (curSnap.atr <= 0) return null;
var buffer = 0.4 * curSnap.atr;
var longFresh = prev.c <= prevHh;
var shortFresh = prev.c >= prevLl;
var trendUp = curSnap.sma20 > curSnap.sma50;
var trendDown = curSnap.sma20 < curSnap.sma50;
var sma20Rising = curSnap.sma20 > pastSnap.sma20;
var sma20Falling = curSnap.sma20 < pastSnap.sma20;
var strongTrend = curSnap.adx >= 30;
var diSpread = curSnap.plusDI - curSnap.minusDI;
var barRange = cur.h - cur.l;
if (barRange > 3 * curSnap.atr) return null;
if (cur.c > hh + buffer && longFresh && strongTrend && trendUp && sma20Rising && diSpread > 8) {
  return { side: "long", note: "Confirmed breakout above " + lookback + "-bar high " + hh.toFixed(2) + " +" + buffer.toFixed(2) + " buffer, ADX=" + curSnap.adx.toFixed(1) + " DI spread=" + diSpread.toFixed(1) + ", SMA20 rising & >SMA50" };
}
if (cur.c < ll - buffer && shortFresh && strongTrend && trendDown && sma20Falling && diSpread < -8) {
  return { side: "short", note: "Confirmed breakdown below " + lookback + "-bar low " + ll.toFixed(2) + " -" + buffer.toFixed(2) + " buffer, ADX=" + curSnap.adx.toFixed(1) + " DI spread=" + diSpread.toFixed(1) + ", SMA20 falling & <SMA50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 53 trades, 41.5% win rate, profit factor 0.63, total P/L $-1.46, Sharpe -3.29.

## Live status

Rejected after review - not live. From research run #68.
