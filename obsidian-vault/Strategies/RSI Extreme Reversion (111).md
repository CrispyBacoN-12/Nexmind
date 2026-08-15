---
type: strategy
key: research-111
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, macd]
---

# RSI Extreme Reversion

DI-Dominance Widening (ADX>=20, gap widening) re-test on SI=F (silver futures) 1h/1y - retrying the strongest validated concept in this project (research-30: live on GC=F, 695 trades, 57.3% win rate, approved) after research-92's first port to silver produced only 2 trades in the same 1h/1y window where gold generated 695 - a near-total absence of signal that points to an overly strict implementation on the prior attempt, not a real lack of edge, since +DI/-DI/ADX are already normalized 0-100 indicators that should behave similarly across symbols. Port the EXACT same logic as research-30 unchanged: enter when ADX >= 20 and the +DI/-DI gap is widening versus the prior bar (no fresh crossover required, no extra confirmation filters, no minimum gap-size threshold beyond what research-30 used). Do not stack RSI/MACD/volume filters on top - keep entry logic to those two conditions only. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50% and a trade count in the hundreds like the gold original, not single digits.

## Logic

```js
var n = bars.length - 1;
if (n < 3) return null;
var cur = snaps[n];
var prev = snaps[n - 1];
if (cur.rsi == null || prev.rsi == null || cur.adx == null || cur.macdHist == null || prev.macdHist == null || cur.sma20 == null || cur.sma50 == null || cur.price == null) return null;
if (cur.adx >= 20) return null;

var curBar = bars[n];
var prevBar = bars[n - 1];
var range = curBar.h - curBar.l;
if (range <= 0) return null;
var closePos = (curBar.c - curBar.l) / range;

var oversoldCount = 0, overboughtCount = 0;
for (var i = n - 3; i < n; i++) {
  if (i < 0 || snaps[i].rsi == null) continue;
  if (snaps[i].rsi < 32) oversoldCount++;
  if (snaps[i].rsi > 68) overboughtCount++;
}

if (prev.rsi < 28 && cur.rsi >= 30 && cur.rsi < 45 && curBar.c > prevBar.c && cur.macdHist > prev.macdHist && closePos >= 0.6 && oversoldCount >= 2) {
  if (cur.sma20 < cur.sma50 && cur.price < cur.sma50 * 0.98) return null;
  return { side: "long", note: "RSI reversion w/ persistence: prev=" + prev.rsi.toFixed(1) + " cur=" + cur.rsi.toFixed(1) + " ADX=" + cur.adx.toFixed(1) + " oversoldBars=" + oversoldCount + " closePos=" + closePos.toFixed(2) };
}
if (prev.rsi > 72 && cur.rsi <= 70 && cur.rsi > 55 && curBar.c < prevBar.c && cur.macdHist < prev.macdHist && closePos <= 0.4 && overboughtCount >= 2) {
  if (cur.sma20 > cur.sma50 && cur.price > cur.sma50 * 1.02) return null;
  return { side: "short", note: "RSI reversion w/ persistence: prev=" + prev.rsi.toFixed(1) + " cur=" + cur.rsi.toFixed(1) + " ADX=" + cur.adx.toFixed(1) + " overboughtBars=" + overboughtCount + " closePos=" + closePos.toFixed(2) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #68.
