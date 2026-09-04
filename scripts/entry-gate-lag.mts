// Which gate was the rule still waiting on?
//
// entry-lateness.log established that the desk's baseline entry commits late:
// replaying the same signals two or three bars earlier flips the matched-control
// margin positive in 5/5 folds and both exit geometries. That is a diagnostic and
// cannot be traded. This script is the bridge to something that can be: if the
// loss lives in the waiting, the useful question is WHAT the rule was waiting on,
// because that names the gate to relax.
//
// Method. decideSetup is a sequential gate chain — ADX floor, then trend/DI
// alignment, then the RSI pullback band, then the MACD-not-rolling-over check
// (longs only), then the confluence vetoes (inert at DEFAULT_THRESHOLDS). Take
// every ONSET bar, i.e. a bar where the setup fires and the bar before it did
// not, and read which gate refused at i-1, i-2, i-3. That is not a guess about
// the mechanism; it is the rule's own reported reason, replayed.
//
// Two tallies are kept because they answer different questions:
//   blocker  — the first gate that refused (what decideSetup would have logged)
//   sole     — the same, restricted to bars where exactly one gate was failing,
//              which is where relaxing that one gate would actually have let the
//              trade through a bar earlier
//
//   npx tsx scripts/entry-gate-lag.mts
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import { sliceFold } from "@/lib/research/panelRun";
import { barSnapshots, WARMUP } from "@/lib/backtest/engine";
import { decideSetup, DEFAULT_THRESHOLDS, type ScanSnapshot, type SetupThresholds } from "@/lib/trading/scanner";

const FOLD_LIST = Object.values(FOLDS);
const LOOKBACK = [1, 2, 3];
const GATES = ["data", "adx", "align", "rsi_lo", "rsi_hi", "macd"] as const;
type Gate = (typeof GATES)[number];

/**
 * Re-derive decideSetup's gate chain, returning EVERY gate that fails rather
 * than only the first. The order below mirrors scanner.ts exactly; if that file
 * changes, this diagnostic is reading a rule that no longer exists.
 *
 * `align` decides the side, so `macd` cannot be evaluated when `align` fails —
 * it is reported as passing there rather than guessed at, which is why `sole`
 * (exactly one failure) is the tally to trust.
 */
function failures(s: ScanSnapshot, t: SetupThresholds = DEFAULT_THRESHOLDS): Gate[] {
  const out: Gate[] = [];
  const { sma20: s20, sma50: s50, rsi: r, adx: a, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal } = s;
  if (a == null || s20 == null || s50 == null || r == null || pDI == null || mDI == null) return ["data"];
  if (a <= t.adxFloor) out.push("adx");
  const up = s20 > s50 && pDI > mDI;
  const down = s20 < s50 && mDI > pDI;
  if (!up && !down) out.push("align");
  // Split, because the two ends mean opposite things: below the band the rule
  // is refusing a pullback that has gone too deep, above it the rule is waiting
  // for a running trend to cool off. Relaxing them are different proposals.
  if (r < t.rsiLow) out.push("rsi_lo");
  else if (r > t.rsiHigh) out.push("rsi_hi");
  if (up && !(hist == null || hist > -Math.abs((atrVal ?? 1) * 0.1))) out.push("macd");
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? "   —  " : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols · gates read at DEFAULT_THRESHOLDS (ADX>${DEFAULT_THRESHOLDS.adxFloor}, RSI ${DEFAULT_THRESHOLDS.rsiLow}-${DEFAULT_THRESHOLDS.rsiHigh})\n`);

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    // blocker[k][gate] and sole[k][gate], k = bars before the onset
    const blocker = new Map<number, Map<Gate, number>>();
    const sole = new Map<number, Map<Gate, number>>();
    const seen = new Map<number, number>();
    for (const k of LOOKBACK) {
      blocker.set(k, new Map(GATES.map((g) => [g, 0])));
      sole.set(k, new Map(GATES.map((g) => [g, 0])));
      seen.set(k, 0);
    }
    let onsets = 0;

    for (const slice of slices) {
      const snaps = barSnapshots(slice.candles);
      const start = Math.max(WARMUP, slice.entryFrom ?? 0);
      let prevFired = false;
      for (let i = start; i < snaps.length; i++) {
        const fired = decideSetup(snaps[i]).side != null;
        if (fired && !prevFired) {
          onsets++;
          for (const k of LOOKBACK) {
            const j = i - k;
            if (j < start) continue;
            seen.set(k, seen.get(k)! + 1);
            const f = failures(snaps[j]);
            if (f.length === 0) continue; // fired at j too — not a wait, a re-entry gap
            blocker.get(k)!.set(f[0], blocker.get(k)!.get(f[0])! + 1);
            if (f.length === 1) sole.get(k)!.set(f[0], sole.get(k)!.get(f[0])! + 1);
          }
        }
        prevFired = fired;
      }
    }

    console.log(`${fold.name}  ${onsets} signal onsets`);
    console.log(`  bars back  ${GATES.map((g) => g.padStart(7)).join(" ")}   (first gate to refuse, % of onsets)`);
    for (const k of LOOKBACK) {
      const d = seen.get(k)!;
      console.log(`      t-${k}    ${GATES.map((g) => pct(blocker.get(k)!.get(g)!, d)).join(" ")}`);
    }
    console.log(`  bars back  ${GATES.map((g) => g.padStart(7)).join(" ")}   (SOLE refusing gate, % of onsets)`);
    for (const k of LOOKBACK) {
      const d = seen.get(k)!;
      console.log(`      t-${k}    ${GATES.map((g) => pct(sole.get(k)!.get(g)!, d)).join(" ")}`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
