# Exit geometry sweep — pre-registered picks

Written 2026-08-24 **after** running `--split=is --interval=1wk --every=3` and
**before** any out-of-sample run. Committed in this state so the picks cannot be
edited once the OOS table exists.

Entry rule fixed: trend-pullback @ `DEFAULT_THRESHOLDS`. 158 S&P symbols with
enough weekly history, 20 exit variants, costs 0.5bps slippage + 1bp commission.
Baseline (SL 1.5 / TP 2.5 / tp2 ladder): 2073 trades, avgR +0.076, t 2.51,
totalR 158.4, PF 1.19.

## Picks

1. **trail 1.5/1.5** — best row on the sample: t 4.69, totalR 319.5 (2.0x
   baseline), avgR +0.113 (+0.037). Chosen because it is the strongest on every
   axis at once, not just avgR.
2. **trail 1.0/1.5** — t 4.23, totalR 278.9. Chosen as the *neighbour* of pick 1.
   If trailing genuinely helps, an adjacent cell should hold up too; if only the
   exact 1.5/1.5 cell survives OOS, that is evidence of a noise spike rather
   than an effect, and pick 1 should be discarded with it.
3. **single 2.5 ATR** — best non-trailing row: totalR 233.7, PF 1.26 (the only
   PF above baseline), t 3.48. Chosen from a different axis, to separate
   "trailing stops help" from "anything beats the default ladder".

## Deliberately not picked

- **TP 5.0 ATR** has the highest avgR of the table (+0.131) and is rejected
  anyway: t 2.39, *below* baseline. Its mean rides on a handful of fat winners
  (sdR 2.03 vs 1.39), which is exactly the shape that does not repeat.
- **SL 3.0 ATR** has t 3.61 but totalR 131, below baseline — it raises
  expectancy per trade by taking far fewer trades. Not wrong, just not an
  improvement in total.

## Result to report regardless of the OOS outcome

**single 1.2 ATR is the worst row in the table**: avgR +0.037, the lowest of all
20, against baseline's +0.076. That is the exact ladder every `research-N`
strategy trades live (`RESEARCH_ATR_TP_MULT=1.2` / `RESEARCH_ATR_SL_MULT=1.5` in
`src/lib/trading/engine.ts`) — 0.8:1 reward:risk. It wins 57.7% of the time and
still earns half the baseline's expectancy, because at 0.8:1 a 57.7% win rate is
barely above the ~55.6% break-even. research-29 ran this ladder live at a 43.8%
win rate. The entry rule was unvalidated, but the exit geometry was set up to
lose independently of it.

## Caveat on the PF column

Several trail rows show totalR above baseline while PF sits below it. PF is
computed on dollars and totalR on risk-normalised R, and ATR varies across
symbols and eras, so a high-ATR trade weighs more in the PF ratio than in the R
sum. Where the two disagree, R is the number that matters here — it is what the
desk sizes against.
