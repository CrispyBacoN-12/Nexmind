---
type: strategy
key: research-73
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, gold]
---

# Volume Climax Fade (gold)

Volume climax exhaustion fade for gold (GC=F, 1h) - the range-market mechanisms tried so far (RSI extreme, ATR-band distance, MACD exhaustion) all use price/oscillator data and all failed blind test or in-sample. This uses volume instead: a bar with volume > 2x the trailing 20-bar average, in a low-ADX (non-trending) regime, is treated as a climax/capitulation bar and faded.

## Logic

```js
var i = bars.length - 1;
if (i < 20) return null;
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx > 25) return null;
var volSum = 0, volCnt = 0;
for (var k = i - 20; k < i; k++) {
  if (bars[k].v != null) { volSum += bars[k].v; volCnt++; }
}
if (volCnt < 15) return null;
var avgVol = volSum / volCnt;
var c = bars[i];
if (c.v == null || avgVol <= 0) return null;
var bullish = c.c > c.o, bearish = c.c < c.o;
if (c.v > avgVol * 2 && bearish) return { side: "long", note: "volume climax on bearish bar (" + (c.v / avgVol).toFixed(1) + "x avg), fading" };
if (c.v > avgVol * 2 && bullish) return { side: "short", note: "volume climax on bullish bar (" + (c.v / avgVol).toFixed(1) + "x avg), fading" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 243 trades, 48.6% win rate, profit factor 0.74, total P/L $-96.16, Sharpe -2.84.

## Live status

Rejected after review - not live. From research run #46.
