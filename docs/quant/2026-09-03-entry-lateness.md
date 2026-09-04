# The baseline entry rule loses to random entry, and the loss is in the waiting

**Run 2026-09-03.** Panel: `.cache/bars/sp500-1d.json`, 491 symbols, the five
pre-registered folds. Entry rule: the desk's own baseline
(`computeEntrySignals` defaults) — the same rule `trend-pullback` runs.
Scripts: `scripts/ladder-transfer.mts`, `scripts/control-atr-bias.mts`,
`scripts/entry-lateness.mts`. Logs of the same names under `scripts/`.

This started as a check on whether `sweepLadder`'s FIT-chosen exit ladder
transfers out of sample. It does. The finding is what turned up alongside it.

---

## 1. The exit ladder transfers; the sweep barely does anything

avgR by ladder × fold, rank in that fold in parentheses:

| ladder | fit | select | test1 | test2 | test3 |
|---|---|---|---|---|---|
| single 1.5 | +0.004 (6) | −0.044 (1) | +0.014 (6) | −0.031 (3) | −0.010 (6) |
| single 2.0 | +0.010 (5) | −0.045 (2) | +0.025 (5) | −0.040 (4) | −0.009 (5) |
| single 2.5 | +0.013 (4) | −0.065 (5) | +0.044 (4) | −0.054 (5) | −0.008 (4) |
| single 3.0 | +0.023 (3) | −0.072 (6) | +0.056 (3) | −0.072 (6) | +0.001 (3) |
| trail 1.0/1.5 | +0.049 (2) | −0.059 (3) | +0.061 (2) | **+0.003 (1)** | +0.036 (2) |
| trail 1.5/1.5 | **+0.050 (1)** | −0.059 (4) | **+0.062 (1)** | −0.016 (2) | **+0.041 (1)** |

Spearman rho of the ladder ordering vs FIT: **test1 +1.00, test3 +1.00,
test2 +0.37, select −0.54.** SELECT is the outlier and it is the fold where
every geometry is negative across a spread of 0.028 — a ranking of "least bad",
not a ranking.

**`sweepLadder` is not fitting noise** — the earlier worry was wrong. But it is
also doing very little: the answer is a trail in 4 of 5 folds, and the trail
pair sits at ranks 1-2 in all four. The exit effect size (trail minus
single 1.5) is **≈ +0.046R**, against a baseline entry effect of ~+0.04R at
t = 1.08. **The exit is the larger and far more stable of the two.**

## 2. But the rule loses to a matched random entry in 30 of 30 cells

Rule avgR minus the matched random-entry control's **median**, 200 runs per
cell. Negative means random entry did better.

| ladder | fit | select | test1 | test2 | test3 |
|---|---|---|---|---|---|
| single 1.5 | −0.014 | −0.130 | −0.030 | −0.037 | −0.031 |
| single 2.0 | −0.017 | −0.164 | −0.036 | −0.049 | −0.037 |
| single 2.5 | −0.024 | −0.219 | −0.034 | −0.070 | −0.045 |
| single 3.0 | −0.023 | −0.255 | −0.045 | −0.093 | −0.046 |
| trail 1.0/1.5 | −0.037 | −0.213 | −0.039 | −0.045 | −0.035 |
| trail 1.5/1.5 | −0.044 | −0.236 | −0.048 | −0.063 | −0.039 |

Every cell is negative. And the deficit is **monotone in target width in 5/5
folds**: 1.5 → 3.0 gets steadily worse (select: −0.130 → −0.255), and
`single 3.0` is the worst cell in three folds — worse than either trail.

A rule with merely no edge would sit near the control at every target width.
A deficit that scales with **how far price still has to travel after entry** is
a statement about entry timing.

### 2a. It is not an ATR-denominator artifact

R divides by `slMult × ATR at entry`. The rule fires only after ADX > 20, i.e.
once volatility has expanded, so it was worth checking whether the control was
simply landing on quieter bars and collecting a smaller denominator.

ATR/price at entry, rule median ÷ control median:
**fit 1.014 · select 1.002 · test1 1.003 · test2 1.015 · test3 1.011.**

At most 1.5%. It cannot produce a 0.034R spread. **Confound refuted** — the
negative margins mean what they appear to mean.

## 3. The loss is in the waiting, not in the names

Replay the same signals *k* bars earlier and recompute the control at each *k*
(100 runs per cell). **This is lookahead and cannot be traded** — you only learn
the rule fired at bar *t*. It answers one question about the past: at the moment
the rule committed, how much of the move had already happened?

Margin over the matched control, `trail 1.5/1.5`:

| shift | fit | select | test1 | test2 | test3 |
|---|---|---|---|---|---|
| t−0 | −0.043 | −0.236 | −0.048 | −0.062 | −0.039 |
| t−1 | −0.058 | −0.242 | −0.088 | −0.090 | −0.069 |
| t−2 | +0.066 | −0.105 | +0.057 | +0.007 | +0.052 |
| t−3 | **+0.185** | +0.021 | **+0.164** | **+0.109** | **+0.174** |
| t−5 | +0.381 | +0.242 | +0.394 | +0.339 | +0.411 |
| t−8 | +0.635 | +0.501 | +0.619 | +0.623 | +0.635 |

`single 1.5` has the same shape (t−0 −0.014 → t−3 +0.064 → t−8 +0.386 on FIT).

**Three bars of removed confirmation lag flips the sign in 5/5 folds, on both
geometries.** The names were right. The bars were wrong.

The t−1 dip is real and worth keeping in view: entering exactly one bar early is
*worse* than entering on time, in every fold and both geometries. One bar early
is inside the pullback's final flush, where a 1.5 ATR stop placed at that bar's
price gets hit before the reversal. The gain only starts at t−2.

### What this does and does not license

- **Does not** license quoting +0.6R as an available edge. At k = 8 the shift is
  using the knowledge that a confirmed continuation will fire eight bars later;
  that is most of the number.
- **Does** establish the direction and give it a measured target: the rule's
  confirmation conditions — ADX > 20, a completed pullback, DI alignment, a MACD
  histogram not rolling over — are each true only *after* the move starts, and
  together they cost roughly 0.2R at three bars.
- **Does** explain the 13 rejected confluence filters as one result rather than
  thirteen. Every one of them added a further condition to a rule already
  committing late. They were not thirteen unlucky ideas; they were thirteen
  instances of pushing the entry further into the move.
- Timeframe caveat: the panel is **daily**. The desk trades **weekly**, where
  three bars is three weeks. The lag is measured here, not there.

## 4. What this says about the panel gate

`runControl` gives the control the **same exit** as the rule. So an exit that is
genuinely better lifts both arms and the margin barely moves: **the gate can
credit entry skill and the entry×exit interaction, and cannot credit an exit's
standalone contribution.** That is by design and it is the right null for an
entry claim — but it means the ATR trail, the one geometry in this repo with a
real out-of-sample pedigree, could never have been approved *by this gate*. It
was validated on the sweep harness, against the baseline ladder, which is the
correct control for an exit change.

If exits are ever to be researched rather than swept, that second control —
same entries, baseline ladder — has to exist. It does not today.

## 5. Standing conclusion

The desk's problem is not that its entry rule has no edge. It is that the rule
**has negative selection value at the bar level** — 30 of 30 cells — while
picking names whose subsequent moves are good enough that entering earlier on
the very same names beats random by +0.18R at three bars. Research effort spent
on additional entry *confirmation* is spent in the wrong direction, and has been
since at least the confluence sweep.

---

# Follow-up, same day: which gate does the waiting, and can it be relaxed?

§3 says the loss lives in the waiting. That is a mechanism, not a trade. Two
further runs turn it into one: name the gate the rule is waiting on, then test
whether relaxing that gate — a rule that could actually have been traded, using
only bar *i*'s own data — recovers any of the lateness gain.

## 6. The rule is waiting on the RSI band

`scripts/entry-gate-lag.mts` walks every **signal onset** (the rule fires at bar
*i* and did not fire at *i−1*) and asks which gate of `decideSetup` refused at
*i−1*, *i−2*, *i−3*. Two tallies are printed: the *first* gate to refuse in chain
order, and the *sole* gate refusing when exactly one failed. The sole tally is
the one to read — a gate that is merely first in the chain may not be the binding
one. The RSI test is split by direction, because the two ends mean opposite
things: below the band the rule is refusing a pullback that has gone too deep,
above it the rule is waiting for a running trend to cool off.

Sole refusing gate at **t−1**, as a share of onsets (`scripts/entry-gate-lag.log`):

| fold | onsets | adx | align | rsi_lo (<35) | rsi_hi (>70) | macd |
|---|---:|---:|---:|---:|---:|---:|
| fit | 18,370 | 12.6% | 19.3% | 23.0% | 30.6% | 11.0% |
| select | 6,605 | 13.5% | 17.5% | 17.4% | 35.7% | 12.4% |
| test1 | 13,061 | 13.9% | 16.0% | 21.2% | 32.6% | 12.6% |
| test2 | 13,558 | 12.7% | 18.9% | 35.6% | 22.5% | 6.3% |
| test3 | 18,080 | 12.2% | 18.4% | 25.7% | 28.4% | 11.4% |

**The RSI band alone accounts for 53–58% of the lag in all five folds**, against
~19% for DI/SMA alignment, ~13% for the ADX floor and ~11% for the MACD check.
In four of five folds the binding end is **RSI > 70** — the rule is standing
aside from a trend that is running. TEST2 (2022-23) is the exception and flips to
the low end, which is what a bear market should do to this tally.

## 7. Relaxing that gate does not recover the gain

`scripts/entry-lag-variants.mts`, pre-registered before any fold was run: eight
variants, each moving one gate (plus two pairs), measured by **margin over the
matched control**, not raw avgR. Selection rule fixed in advance — a variant is a
candidate only if it beats the baseline's margin on FIT **and** SELECT **and**
both exit geometries, four cells.

`vs base` (variant margin − baseline margin in the same cell),
`scripts/entry-lag-variants.log`:

| variant | fit/single | fit/trail | select/single | select/trail | candidate? |
|---|---:|---:|---:|---:|---|
| adx 15 | +0.001 | +0.009 | +0.010 | +0.022 | **yes** |
| adx rising | −0.018 | −0.011 | +0.005 | +0.009 | no |
| macd off | −0.007 | −0.008 | −0.002 | −0.009 | no |
| rsi low 30 | −0.002 | +0.005 | +0.008 | +0.010 | no |
| rsi high 80 | −0.009 | −0.020 | −0.035 | −0.051 | no |
| rsi 30-80 | −0.011 | −0.018 | −0.028 | −0.042 | no |
| rsi30-80+macd | −0.015 | −0.021 | −0.023 | −0.032 | no |

Baseline margins for scale: −0.014 / −0.044 / −0.130 / −0.236. **Every variant's
margin is still negative in every cell.** Nothing here made the rule beat random;
the best case narrows a deficit.

**The finding is the sign, not the winner.** The gate the lateness diagnostic
pointed straight at — RSI, and specifically the >70 end — is the gate whose
relaxation makes things *worst*, monotonically, in all four cells. That is not a
contradiction of §3, it is the boundary of what §3 licenses:

- Shifting an entry earlier keeps the *same trades* and only moves their price.
- Relaxing a gate keeps nothing. It admits a **new population** of trades, and
  the control median rises with it — fit/single control median goes +0.018 for
  the baseline to +0.036 for `rsi high 80`. The extra bars are bars where a
  random entry already does well, i.e. the relaxation is buying exposure.

That distinction is exactly what the matched control exists to expose, and here
it earns its keep: three of the eight variants **raise raw avgR** over the
baseline on fit/single (`macd off` +0.014, `rsi high 80` +0.013, `adx rising`
+0.010, vs baseline +0.004) while losing to their own controls. Read without the
control, three of eight would have looked like wins.

## 8. Holdout: `adx 15` replicates 6/6, and still never crosses zero

Run after the candidate list above was written down, on TEST1/TEST2/TEST3 only
(`scripts/entry-lag-variants-holdout.log`). `vs base` per cell:

| variant | t1/single | t1/trail | t2/single | t2/trail | t3/single | t3/trail |
|---|---:|---:|---:|---:|---:|---:|
| **adx 15** | **+0.010** | **+0.011** | **+0.004** | **+0.006** | **+0.003** | **+0.011** |
| adx rising | +0.004 | +0.008 | +0.015 | +0.019 | −0.017 | −0.025 |
| macd off | +0.001 | +0.002 | −0.007 | −0.010 | −0.000 | −0.003 |
| rsi low 30 | +0.009 | +0.027 | −0.007 | −0.007 | −0.002 | +0.002 |
| rsi high 80 | −0.015 | −0.022 | −0.001 | −0.007 | −0.012 | −0.021 |
| rsi 30-80 | −0.006 | +0.004 | −0.008 | −0.015 | −0.013 | −0.020 |
| rsi30-80+macd | −0.004 | +0.008 | −0.012 | −0.018 | −0.014 | −0.019 |

**The one candidate replicated: `adx 15` is positive in all six held-out cells,
10 of 10 across the whole panel.** It is also the only variant that is. `adx
rising`, which looked close on SELECT, would have failed anyway — it inverts on
TEST3 (−0.017 / −0.025), which is what the selection split is for. `rsi high 80`
is negative in 10 of 10.

**Its signature is the right one, and that is the interesting part.** Lowering the
ADX floor from 20 to 15 admits ~35% more trades, and unlike every RSI relaxation
the **control median falls** as it does so — fit/trail +0.094 → +0.092, select/trail
+0.177 → +0.169, test1/trail +0.110 → +0.105, test3/trail +0.080 → +0.072, 9 of
10 cells — while the rule's own avgR **rises** in 9 of 10. So the bars a lower ADX
floor lets in are bars where a random entry does *worse* and the rule does
*better*. That is precisely what entering earlier is supposed to look like, and
the opposite of the exposure signature in §7.

**And it is still not a result the desk can use.** The size is +0.009R averaged
over the ten cells, against baseline deficits of −0.014 to −0.236, so the margin
stays **negative in all ten**: the rule loses to a random entry by slightly less.
The panel gate asks for a margin over the control **p95**, not for a smaller loss
against the median. `adx 15` does not come close, and nothing here is an approval.

### What the pair of runs actually settles

- **The lag is real, it is mostly the RSI band, and it cannot be removed by
  widening that band.** §6 and §7 together.
- **One gate — the ADX floor — is genuinely set too late**, replicated 10/10 with
  the correct control signature. It is worth ~0.009R, which is not a strategy.
- **The lateness gain of §3 is therefore not reachable by relaxing gates.** The
  +0.18R at t−3 came from moving the *same* trades earlier. Every gate relaxation
  available here changes *which* trades are taken instead. Recovering the §3 gain
  would need a rule that anticipates the same setup rather than one that admits
  more setups — which is a different mechanism, not a threshold.

---

## 9. Anticipation: the closing test, 2026-09-05

§8 ended by naming the one direction left — "a rule that anticipates the same
setup rather than one that admits more setups". `scripts/entry-anticipation.mts`
is that test, and it is designed so it cannot be answered by exposure.

**Construction.** Two gates get a *pad*: a band around the real threshold where a
bar fails the rule but is close to passing. Every padded variant comes in a pair:

| | admits the pad | also requires the reading to be closing on the threshold |
|---|---|---|
| RSI ±5 | `rsi widen 5` | `rsi approach 5` |
| RSI ±10 | `rsi widen 10` | `rsi approach 10` |
| ADX −5 | `adx widen 5` | `adx approach 5` |
| both | `both widen 5` | `both approach 5` |

`approach` reads bars *i* and *i−1* only — RSI above the band must be falling
toward it, below it rising; ADX below the floor must be rising. Nothing reads
forward. The pre-registered bar was: beat the baseline **and** the paired widen
variant, on FIT and SELECT and both geometries — four cells.

A new column, `lead%`, measures anticipation directly: of the bars a variant
signals on that the baseline does not, the share followed by a baseline signal of
the same side within 3 bars. `simulateExits` holds one position per symbol, so an
early signal takes the trade and the baseline's own signal is then skipped — this
is the "same trade, earlier bar" mechanism, and `lead%` says how much of it is
really happening rather than assumed.

**The harness agrees with the previous one.** `adx widen 5` reproduces `adx 15`
from §7 to three decimals in all four cells (+0.001 / +0.009 / +0.010 / +0.022),
so the baseline row is bit-identical and the new columns sit on the old numbers.

### Result: no candidate, and the two gates disagree about why

`vs base`, all four selection cells:

| variant | fit/single | fit/trail | select/single | select/trail | lead% |
|---|---|---|---|---|---|
| rsi approach 5 | −0.002 | −0.002 | −0.003 | −0.010 | 60.1% |
| rsi widen 5 | −0.009 | −0.010 | −0.018 | −0.028 | 61.5% |
| rsi approach 10 | −0.000 | −0.003 | −0.005 | −0.015 | 52.5% |
| rsi widen 10 | −0.009 | −0.016 | −0.027 | −0.038 | 52.7% |
| **adx approach 5** | −0.001 | +0.002 | +0.002 | +0.005 | 31.4% |
| **adx widen 5** | +0.001 | +0.009 | +0.010 | +0.022 | 18.0% |
| both approach 5 | −0.004 | +0.000 | −0.000 | −0.005 | 39.7% |
| both widen 5 | −0.007 | −0.002 | −0.005 | +0.001 | 34.7% |

Not one variant beats the baseline in 4/4. The best is `adx approach 5` at 3/4,
failing fit/single — and it loses to plain widening in all four.

**The two pads answer the direction question in opposite directions, and that is
what settles the hypothesis rather than merely failing it.**

- **RSI.** `approach` beats `widen` in 4/4, recovering roughly two thirds of the
  harm widening does. But `lead%` is **60.1 against widening's 61.5**. The
  direction test discarded 69% of the extra signals (23,345 → 7,225) and did not
  improve onset prediction at all. Whatever it recovered, it did not recover by
  anticipating the setup — it recovered by trading less.
- **ADX.** `approach` lifts `lead%` from **18.0% to 31.4%** — a real +13pp gain at
  predicting the baseline's own trigger — and **loses** to plain widening in 4/4.
  Predicting the onset better made the returns worse.

So the two things the hypothesis had treated as one — *firing earlier on the same
setup* and *predicting when the setup fires* — are measurably distinct, and where
they were separable they pointed opposite ways. That is what the 30/30 control
result of §3 implies once it is read at the bar level: the baseline's trigger bar
is negatively selected, so a rule that homes in on it more accurately inherits
the selection rather than escaping it.

**Caveat, stated so the table is not over-read:** `lead%` is confounded with which
gate is padded — RSI pads score high on it, ADX pads low — so the cross-gate
ordering is not evidence by itself. The within-gate pairs are the clean
comparisons, and they are the two bullets above.

**What this does and does not close.** It does not prove no anticipation rule can
work; it tests the family reachable by padding the two gates that actually bind.
It does refute the premise that firing earlier on the same setup is worth
something causally — which was the premise §3's t−3 result appeared to support,
and which was measured there by moving signals that were already known to occur.

### Where the entry axis stands after three runs

| question | answer |
|---|---|
| Is the entry rule late? | Yes — loses to random in 30/30 cells; t−3 replay is +0.18R in 5/5 folds |
| What is it waiting on? | The RSI band, sole refusing gate in 53–58% of onsets; binding end is RSI>70 in 4/5 folds |
| Can relaxing that gate recover it? | No — 8 relaxations, margin negative in 10/10 cells |
| Is any gate genuinely set too late? | One: the ADX floor, +0.009R, replicated 10/10. Not a strategy |
| Can a causal rule anticipate the setup? | No — 4 variants, none beats the baseline in 4/4; better onset prediction made returns *worse* |

The remaining untried axis is not a threshold, a gate, or a bar. It is the **data
class**: every mechanism screened across two universes has been a function of
`ScanSnapshot`, which is price and volume only. Changing that is engine work — a
point-in-time event source and a field to carry it — not a change to a research
brief, and it belongs with the other capability gap this project has recorded (the
proposer cannot express an exit or a size either).
