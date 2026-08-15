---
type: strategy
key: research-133
status: approved
symbol: "NG=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, atr]
---

# Breakout: 20-Bar Range Break with Volume + ADX Confirmation

DI-Dominance Widening entry signal (fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required - the same logic behind the live gold strategy research-30: 695 trades, 57.3% win rate, approved) for NG=F (natural gas futures) 1h/1y. This is a genuinely fresh symbol test: natural gas has never been tried in this project, and DI-Dominance Widening is the single strongest validated concept here, already ported to SI=F (rejected, both attempts had thin trade counts or negative expectancy) and CL=F (crossover variant, rejected, trades too thin). Natural gas is a classically trend-prone commodity like gold, so this checks whether the mechanism generalizes to a third commodity. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%, adequate trade count (widen range if signal is rare).

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var s = snaps[i];
var sPrev = snaps[i - 1];
if (!s || s.adx == null || s.atr == null || s.plusDI == null || s.minusDI == null) return null;
if (!sPrev || sPrev.adx == null) return null;
if (s.sma20 == null || s.sma50 == null) return null;
if (s.adx < 28) return null;
if (s.adx <= sPrev.adx) return null;
var diSpread = Math.abs(s.plusDI - s.minusDI);
if (diSpread < 6) return null;
var hh = -Infinity, ll = Infinity, volSum = 0;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hh) hh = bars[k].h;
  if (bars[k].l < ll) ll = bars[k].l;
  volSum += bars[k].v;
}
var avgVol = volSum / lookback;
var cur = bars[i];
var prev = bars[i - 1];
if (!avgVol || cur.v < avgVol * 1.75) return null;
var buffer = s.atr * 0.35;
var range = cur.h - cur.l;
if (range <= 0) return null;
var closePos = (cur.c - cur.l) / range;
var freshLongBreak = prev.c <= hh + buffer;
var freshShortBreak = prev.c >= ll - buffer;
if (cur.c > hh + buffer && s.plusDI > s.minusDI && closePos > 0.65 && freshLongBreak && s.sma20 > s.sma50 && cur.c > s.sma20) {
  return { side: "long", note: "20-bar range breakout above " + hh.toFixed(3) + " +ATR buffer, vol " + (cur.v / avgVol).toFixed(2) + "x avg, ADX " + s.adx.toFixed(1) + " rising, DI spread " + diSpread.toFixed(1) + ", trend-aligned, fresh break, strong close" };
}
if (cur.c < ll - buffer && s.minusDI > s.plusDI && closePos < 0.35 && freshShortBreak && s.sma20 < s.sma50 && cur.c < s.sma20) {
  return { side: "short", note: "20-bar range breakdown below " + ll.toFixed(3) + " -ATR buffer, vol " + (cur.v / avgVol).toFixed(2) + "x avg, ADX " + s.adx.toFixed(1) + " rising, DI spread " + diSpread.toFixed(1) + ", trend-aligned, fresh break, weak close" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 33 trades, 57.6% win rate, profit factor 1.25, total P/L $0.02, Sharpe 1.83.

## Live status

Approved - available as `research-133` if assigned to a portfolio's strategy key. From research run #75.
