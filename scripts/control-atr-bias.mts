// Is the matched random-entry control biased in R by where it lands?
//
// R is (price move) / (slMult x ATR at entry). The control keeps the ATR of the
// bar it lands on — deliberately, so its stop is the width the strategy would
// have used there (control.ts). But that makes ATR-at-entry a FREE variable
// between the two arms: the desk's rule only fires after ADX > 20, i.e. once
// volatility has already expanded, while a uniform random entry lands mostly on
// quiet bars. A quiet-bar entry has a small R denominator, so the same
// subsequent price move scores more R.
//
// If that is happening, the control is not a clean null — it is a null with a
// structural head start that grows with how much upside the exit lets run. That
// would show up exactly as ladder-transfer.log shows it: the control's margin
// over the rule widening monotonically from single 1.5 (-0.021) to
// trail 1.5/1.5 (-0.055), i.e. the panel gate being hardest on the one exit
// family with an out-of-sample pedigree.
//
// This script measures the input to that story and nothing else: the
// distribution of ATR/price at the bars each arm actually enters on. It makes
// no claim about R. If the two distributions match, the confound is dead and
// the negative margins mean what they appear to mean.
//
//   npx tsx scripts/control-atr-bias.mts
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import { sliceFold, PANEL_SEED } from "@/lib/research/panelRun";
import { computeEntrySignals, WARMUP } from "@/lib/backtest/engine";
import { matchedRandomSignals, mulberry32, percentile } from "@/lib/research/control";

const FOLD_LIST = Object.values(FOLDS);
const RUNS = 20;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    p25: percentile(s, 0.25),
    median: percentile(s, 0.5),
    p75: percentile(s, 0.75),
    mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
  };
}

async function main() {
  const panel = await loadPanel();
  console.log(`ATR/price at entry — rule vs matched random control (${RUNS} control runs)\n`);
  const w = 10;
  console.log(
    "  " + "fold".padEnd(8) + "arm".padEnd(10) +
    ["n", "p25", "median", "p75", "mean"].map((h) => h.padStart(w)).join(""),
  );

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    const rng = mulberry32(PANEL_SEED);
    const ruleAtrPct: number[] = [];
    const ctrlAtrPct: number[] = [];

    for (const s of slices) {
      const sig = computeEntrySignals(s.candles);
      const start = Math.max(WARMUP, s.entryFrom);
      for (let i = start; i < sig.sides.length; i++) {
        if (sig.sides[i] && sig.atrs[i] > 0 && s.candles[i].c > 0) ruleAtrPct.push(sig.atrs[i] / s.candles[i].c);
      }
      for (let r = 0; r < RUNS; r++) {
        const shuffled = matchedRandomSignals(sig, s.entryFrom, rng);
        for (let i = start; i < shuffled.sides.length; i++) {
          if (shuffled.sides[i] && shuffled.atrs[i] > 0 && s.candles[i].c > 0) ctrlAtrPct.push(shuffled.atrs[i] / s.candles[i].c);
        }
      }
    }

    for (const [arm, xs] of [["rule", ruleAtrPct], ["control", ctrlAtrPct]] as const) {
      const st = stats(xs);
      console.log(
        "  " + fold.name.padEnd(8) + arm.padEnd(10) +
        String(st.n).padStart(w) +
        [st.p25, st.median, st.p75, st.mean].map((v) => (v * 100).toFixed(3).padStart(w)).join(""),
      );
    }
    const rm = stats(ruleAtrPct).median, cm = stats(ctrlAtrPct).median;
    console.log(`  ${"".padEnd(8)}${"ratio".padEnd(10)}${"".padStart(w)}${"".padStart(w)}${(rm / cm).toFixed(3).padStart(w)}   <- rule median / control median\n`);
  }

  console.log(`Values are ATR as a percentage of price at the entry bar.
A ratio above 1 means the rule enters in wider-ATR conditions than the control,
so every R the rule earns is divided by a bigger number. That is a bias in the
denominator, not a difference in skill, and it inflates the control's avgR by
roughly the same ratio.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
