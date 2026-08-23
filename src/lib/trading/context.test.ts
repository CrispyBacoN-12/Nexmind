import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalystContext, personaLens, renderContext } from "./context";
import type { ScanResult, ScanSnapshot } from "./scanner";
import type { Candle } from "@/lib/indicators";

const HOUR = 3600;
const T0 = 1_750_000_000; // fixed epoch — the rendered timestamps must be deterministic

/** A rising series with a shallow pullback at the end, enough bars for the
 *  volume profile (50) and the swing detector to have something to say. */
function series(n = 60): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + i * 0.5 - (i > n - 5 ? (i - (n - 5)) * 1.2 : 0);
    return { t: T0 + i * HOUR, o: base - 0.2, h: base + 0.6, l: base - 0.6, c: base, v: 1_000_000 + i * 1000 };
  });
}

function snapshot(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    price: 128.4, sma20: 126.1, sma50: 120.0, rsi: 58.3, adx: 27.4, plusDI: 29.1, minusDI: 14.2,
    macdHist: 0.42, atr: 1.85, bbPercentB: 0.72, bbWidth: 0.041, stochK: 61.5, stochD: 55.2,
    vwapDevPct: 0.0035, lc: { prediction: 5, signal: 1, kernelBullish: true, kernelBearish: false },
    ...over,
  };
}

function scanResult(over: Partial<ScanResult> = {}): ScanResult {
  return {
    symbol: "AAPL", timeframe: "1h", side: "long", price: 128.4, atr: 1.85,
    snapshot: snapshot(), note: "uptrend pullback · ADX 27 · RSI 58", candles: series(),
    ...over,
  };
}

test("buildAnalystContext: forwards the indicators the old prompt dropped", () => {
  const facts = renderContext(buildAnalystContext(scanResult()));
  // These six reached ScanResult and stopped there before this module existed.
  assert.match(facts, /Bollinger %B 0\.72/);
  assert.match(facts, /bandwidth 4\.10%/);
  assert.match(facts, /Stochastic %K 61\.5 \/ %D 55\.2/);
  assert.match(facts, /VWAP deviation \+0\.35%/);
  assert.match(facts, /Lorentzian classifier: signal long, prediction \+5, kernel bullish/);
  assert.match(facts, /Volume profile: POC /);
});

test("buildAnalystContext: structure always carries levels, even with no up-leg", () => {
  // Monotonically falling: findRecentUpLeg returns null here, which used to
  // leave the structure analyst with nothing to reason from.
  const falling: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const base = 200 - i;
    return { t: T0 + i * HOUR, o: base, h: base + 0.5, l: base - 0.5, c: base, v: 1_000_000 };
  });
  const ctx = buildAnalystContext(scanResult({ candles: falling, price: 141, side: "short" }));
  assert.match(ctx.structure, /No pivot-confirmed up-leg/);
  assert.match(ctx.structure, /Visible range \(last 40 bars\): high 180\.50 .+ low 140\.50/);
  assert.match(ctx.structure, /price sits at 1% of that range/);
});

test("buildAnalystContext: bars block is capped at 20 rows and ends on the latest bar", () => {
  const candles = series(60);
  const ctx = buildAnalystContext(scanResult({ candles }));
  const rows = ctx.bars.split("\n").slice(1); // first line is the header
  assert.equal(rows.length, 20);
  assert.match(rows.at(-1)!, new RegExp(`C ${candles.at(-1)!.c.toFixed(2)}`));
});

test("buildAnalystContext: candle timestamps render the same for seconds and milliseconds", () => {
  const secs = buildAnalystContext(scanResult({ candles: series() }));
  const millis = buildAnalystContext(scanResult({ candles: series().map((c) => ({ ...c, t: c.t * 1000 })) }));
  assert.equal(secs.bars, millis.bars);
  assert.match(secs.bars, /2025-06-1\d \d\d:\d\dZ/);
});

test("buildAnalystContext: optional blocks are omitted, not rendered as n/a", () => {
  const ctx = buildAnalystContext(scanResult());
  assert.equal(ctx.higherTf, null);
  assert.equal(ctx.fundamentals, null);
  assert.equal(ctx.news, null);
  const facts = renderContext(ctx);
  assert.doesNotMatch(facts, /HIGHER TIMEFRAME/);
  assert.doesNotMatch(facts, /INTEL/);
});

test("buildAnalystContext: higher timeframe needs 50 daily bars, and appears once it has them", () => {
  const short = buildAnalystContext(scanResult(), { higherTf: series(40) });
  assert.equal(short.higherTf, null);

  const full = buildAnalystContext(scanResult(), { higherTf: series(60) });
  assert.match(full.higherTf!, /Daily: SMA20 .+ vs SMA50 .+ stacked up/);
  assert.match(full.higherTf!, /Last 5 daily closes:/);
});

test("buildAnalystContext: missing indicators degrade to n/a rather than throwing", () => {
  const bare: ScanSnapshot = { price: 50, sma20: null, sma50: null, rsi: null, adx: null, plusDI: null, minusDI: null, macdHist: null, atr: null };
  const ctx = buildAnalystContext(scanResult({ snapshot: bare, candles: [], price: 50 }));
  assert.match(ctx.momentum, /RSI n\/a/);
  assert.match(ctx.momentum, /alignment unknown/);
  assert.doesNotMatch(ctx.momentum, /Lorentzian/); // absent, not "Lorentzian: n/a"
  assert.equal(ctx.bars, "no candle history available");
  assert.equal(ctx.volume, "no volume history available");
});

test("buildAnalystContext: the live zero-volume bar is labelled, not compared", () => {
  const candles = series();
  const live = candles.at(-1)!;
  const withQuote = [...candles, { t: live.t + HOUR, o: live.c, h: live.c, l: live.c, c: live.c, v: 0 }];
  const ctx = buildAnalystContext(scanResult({ candles: withQuote }));

  assert.match(ctx.bars, /\[live quote, bar not closed\]/);
  // The naive read of that bar is "volume collapsed to zero" — it must instead
  // report the last closed bar, whose volume is normal.
  assert.match(ctx.volume, /Last closed bar volume 1\.06M/);
  assert.doesNotMatch(ctx.volume, /0\.00×/);
});

test("buildAnalystContext: sub-dollar instruments keep more decimals than equities", () => {
  const fx = buildAnalystContext(scanResult({ symbol: "EURUSD=X", price: 1.08421, snapshot: snapshot({ price: 1.08421, sma20: 1.08112, sma50: 1.07934 }) }));
  assert.match(fx.head, /last 1\.084/);
  assert.match(fx.momentum, /SMA20 1\.081 vs SMA50 1\.079/);
});

test("personaLens: each persona is pointed at a different part of the same sheet", () => {
  assert.match(personaLens("trend"), /higher-timeframe/);
  assert.match(personaLens("structure"), /volume-profile POC/);
  assert.match(personaLens("counter"), /Bollinger %B/);
  assert.notEqual(personaLens("trend"), personaLens("structure"));
});

test("renderContext: the facts sheet is identical across personas", () => {
  const ctx = buildAnalystContext(scanResult(), { newsDigest: "Fear & Greed: 61 (greed)" });
  assert.equal(renderContext(ctx), renderContext(ctx));
  assert.match(renderContext(ctx), /INTEL\nFear & Greed: 61 \(greed\)/);
});
