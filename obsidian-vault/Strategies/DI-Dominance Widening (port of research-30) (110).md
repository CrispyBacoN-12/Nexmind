---
type: strategy
key: research-110
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# DI-Dominance Widening (port of research-30)

DI-Dominance Widening (ADX>=20, gap widening) re-test on SI=F (silver futures) 1h/1y - retrying the strongest validated concept in this project (research-30: live on GC=F, 695 trades, 57.3% win rate, approved) after research-92's first port to silver produced only 2 trades in the same 1h/1y window where gold generated 695 - a near-total absence of signal that points to an overly strict implementation on the prior attempt, not a real lack of edge, since +DI/-DI/ADX are already normalized 0-100 indicators that should behave similarly across symbols. Port the EXACT same logic as research-30 unchanged: enter when ADX >= 20 and the +DI/-DI gap is widening versus the prior bar (no fresh crossover required, no extra confirmation filters, no minimum gap-size threshold beyond what research-30 used). Do not stack RSI/MACD/volume filters on top - keep entry logic to those two conditions only. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50% and a trade count in the hundreds like the gold original, not single digits.

## Logic

```js
var n = bars.length - 1;
if (n < 3) return null;
var cur = snaps[n];
var prev = snaps[n - 1];
var prev2 = snaps[n - 2];
var prev3 = snaps[n - 3];
if (cur.adx == null || cur.plusDI == null || cur.minusDI == null) return null;
if (prev.plusDI == null || prev.minusDI == null) return null;
if (prev2.plusDI == null || prev2.minusDI == null) return null;
if (prev3.plusDI == null || prev3.minusDI == null) return null;
if (cur.sma20 == null || cur.sma50 == null || cur.macdHist == null || prev.macdHist == null) return null;
if (cur.rsi == null || cur.atr == null) return null;
if (cur.adx < 28) return null;

var gapCur = cur.plusDI - cur.minusDI;
var gapPrev = prev.plusDI - prev.minusDI;
var gapPrev2 = prev2.plusDI - prev2.minusDI;
var gapPrev3 = prev3.plusDI - prev3.minusDI;

var widening1 = Math.abs(gapCur) > Math.abs(gapPrev);
var widening2 = Math.abs(gapPrev) > Math.abs(gapPrev2);
var widening3 = Math.abs(gapPrev2) > Math.abs(gapPrev3);
if (!widening1 || !widening2 || !widening3) return null;

if (Math.abs(gapCur) < 8) return null;

var macdAccel = Math.abs(cur.macdHist) > Math.abs(prev.macdHist);
if (!macdAccel) return null;

var side = gapCur > 0 ? "long" : "short";

if (side === "long") {
  if (!(cur.sma20 > cur.sma50)) return null;
  if (!(cur.macdHist > 0)) return null;
  if (cur.rsi > 78) return null;
  if (!(cur.price > cur.sma20 - 0.25 * cur.atr)) return null;
} else {
  if (!(cur.sma20 < cur.sma50)) return null;
  if (!(cur.macdHist < 0)) return null;
  if (cur.rsi < 22) return null;
  if (!(cur.price < cur.sma20 + 0.25 * cur.atr)) return null;
}

return { side: side, note: "DI-Dominance widening x3: ADX=" + cur.adx.toFixed(1) + " gap=" + gapCur.toFixed(1) + " (prev " + gapPrev.toFixed(1) + ", " + gapPrev2.toFixed(1) + ", " + gapPrev3.toFixed(1) + ") macd-accel trend-aligned" };
```

## Backtest history

- Research pipeline backtest (1y, 1h): 47 trades, 48.9% win rate, profit factor 0.78, total P/L $-0.68, Sharpe -1.83.

## Live status

Rejected after review - not live. From research run #68.
