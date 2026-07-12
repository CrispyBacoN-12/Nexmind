---
type: strategy
key: research-37
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, atr]
---

# RSI Extreme Bounce off SMA20

test cost/slippage modeling display verification

## Logic

```js
const i = bars.length - 1;
const s = snaps[i];
const sp = snaps[i - 1];
if (!s || !sp || s.rsi == null || sp.rsi == null || s.sma20 == null || s.atr == null) return null;
const price = bars[i].c;
const rsiBounceLong = sp.rsi < 30 && s.rsi >= 30;
const rsiFadeShort = sp.rsi > 70 && s.rsi <= 70;
const nearSMA = Math.abs(price - s.sma20) < s.atr * 2.0;
if (rsiBounceLong && nearSMA) {
  return { side: 'long', note: 'RSI exit oversold (<30), price within 2 ATR of SMA20' };
}
if (rsiFadeShort && nearSMA) {
  return { side: 'short', note: 'RSI exit overbought (>70), price within 2 ATR of SMA20' };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 35 trades, 68.6% win rate, profit factor 1.08, total P/L $65.58, Sharpe 0.61.

## Live status

Proposed candidate, not yet reviewed. From research run #17.
