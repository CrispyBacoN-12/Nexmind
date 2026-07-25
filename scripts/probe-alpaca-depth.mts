// Probe how much intraday history Alpaca's IEX feed actually returns for a
// gold-proxy ETF (GLD) vs what Yahoo gives for GC=F. Answers whether switching
// research to Alpaca-backed equity symbols unlocks a deeper 1h sample.
// Usage: npx tsx scripts/probe-alpaca-depth.mts

import "dotenv/config";
import { fetchAlpacaCandles } from "../src/lib/alpaca";
import { fetchYahooCandles } from "../src/lib/yahoo";

async function main() {
  for (const range of ["2y", "5y", "max"] as const) {
    try {
      const r = await fetchAlpacaCandles("GLD", range, "1h");
      const bars = r.candles;
      const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
      const first = new Date(bars[0].t * 1000).toISOString().slice(0, 10);
      const last = new Date(bars[bars.length - 1].t * 1000).toISOString().slice(0, 10);
      console.log(`Alpaca GLD 1h/${range}: ${bars.length} bars, ${first} -> ${last} (~${days.toFixed(0)} days)`);
    } catch (e) {
      console.log(`Alpaca GLD 1h/${range}: FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  try {
    const y = await fetchYahooCandles("GC=F", "2y", "1h");
    const bars = y.candles;
    const first = new Date(bars[0].t * 1000).toISOString().slice(0, 10);
    const last = new Date(bars[bars.length - 1].t * 1000).toISOString().slice(0, 10);
    console.log(`Yahoo  GC=F 1h/2y: ${bars.length} bars, ${first} -> ${last}`);
  } catch (e) {
    console.log(`Yahoo GC=F 1h/2y: FAILED: ${e}`);
  }
}

main();
