import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";

const WIDENING = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short" };
return null;
`;

const DONCHIAN = `
var i = bars.length - 1;
if (i < 11) return null;
var s = snaps[i];
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.price == null) return null;
if (s.adx < 20) return null;
var hi = -Infinity, lo = Infinity;
for (var k = i - 10; k < i; k++) {
  var pr = snaps[k].price;
  if (pr == null) continue;
  if (pr > hi) hi = pr;
  if (pr < lo) lo = pr;
}
if (s.price > hi && s.plusDI > s.minusDI) return { side: "long" };
if (s.price < lo && s.minusDI > s.plusDI) return { side: "short" };
return null;
`;

const MACD_FLIP = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short" };
return null;
`;

async function main() {
  const resp = await fetchCandles("GC=F", "2y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const widening = compileStrategy(WIDENING);
  const donchian = compileStrategy(DONCHIAN);
  const macd = compileStrategy(MACD_FLIP);

  let wSignals = 0, dSignals = 0, mSignals = 0;
  let wdOverlap = 0, wmOverlap = 0;
  const WINDOW = 3; // bars

  const wTimes: number[] = [], dTimes: number[] = [], mTimes: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const w = widening.invoke(bars, snaps, i)?.side ?? null;
    const d = donchian.invoke(bars, snaps, i)?.side ?? null;
    const m = macd.invoke(bars, snaps, i)?.side ?? null;
    if (w) { wSignals++; wTimes.push(i); }
    if (d) { dSignals++; dTimes.push(i); }
    if (m) { mSignals++; mTimes.push(i); }
  }

  function overlapCount(a: number[], b: number[]) {
    let count = 0;
    let bi = 0;
    for (const ai of a) {
      while (bi < b.length && b[bi] < ai - WINDOW) bi++;
      let j = bi;
      let found = false;
      while (j < b.length && b[j] <= ai + WINDOW) {
        found = true;
        j++;
      }
      if (found) count++;
    }
    return count;
  }

  const dwOv = overlapCount(dTimes, wTimes);
  const mwOv = overlapCount(mTimes, wTimes);

  console.log(`Widening signals: ${wSignals}`);
  console.log(`Donchian signals: ${dSignals}, overlap w/ Widening (within ${WINDOW} bars): ${dwOv} (${(100*dwOv/dSignals).toFixed(1)}% of Donchian signals)`);
  console.log(`MACD-Flip signals: ${mSignals}, overlap w/ Widening (within ${WINDOW} bars): ${mwOv} (${(100*mwOv/mSignals).toFixed(1)}% of MACD signals)`);
}

main();
