# Weekly-bar mechanism screen — results and REJECT

**Spec:** `docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md`
**Scripts (pre-registered, already run — never edit):** `scripts/weekly-mechanism-screen.mts`
(`6563610`), `scripts/weekly-test-rows.mts` (`908ae22`), `scripts/weekly-deep-holdout.mts`
(`4f40757`)
**Logs:** `scripts/weekly-mechanism-screen.log`, `scripts/weekly-test-rows.log`,
`scripts/weekly-deep-holdout.log`

**Verdict: mr-down3 and gap-fade are both REJECTED on weekly bars.** The entry axis that
daily bars closed (`docs/quant/2026-09-03-entry-lateness.md`) is closed on weekly bars too.

## Why weekly bars were tried at all

Daily bars had shown the entry rule losing to random entry in 30 of 30 cells. Weekly bars
were the one remaining cheap variation on the same data: a different bar, the same universe,
the same six mechanisms, and the desk's own timeframe. Everything is resampled from
`.cache/bars/sp500-1d.json` with every weekly bar asserted against its daily source
(RESAMPLER CHECK: pass — 491 symbols, 265,167 weekly bars), so no new data was bought.

Fill is livable throughout: decided at the close of weekly bar *i*, filled at the **open of
bar i+1** (Friday 16:00 ET → Monday 09:30 ET). Design decision #5 of the spec — pre-placed
orders at the next open — is dead and was replaced by this.

## 1. Screen, fit + select (six mechanisms)

`ladder=flat tp1=1.2 sl=1.5`, control = 200 random-entry runs, `seed=20260825`, fold
warm-up 104 weekly bars. Promotion bar, fixed before the run: **beats the control median in
BOTH fit and select at DEFAULT_COST_MODEL**.

| mechanism | fit margin | select margin | verdict |
|---|---|---|---|
| mr-down3 | +0.032 | +0.156 | **ADVANCES** |
| gap-fade | +0.075 | +0.137 | **ADVANCES** |
| nr7 | +0.045 | −0.149 | out |
| turn-of-month | −0.033 | +0.055 | out |
| vol-dryup | +0.153 | −0.145 | out |
| range-expand | +0.065 | −0.122 | out |

The measured 1R came in at 5.6–8.3% of price, against the spec's sqrt-of-time projection of
~8.3% — the projection was the right order, which is what kept the cost arithmetic honest.

## 2. TEST rows — a filter, not a verdict

Criterion fixed in advance: beats the control median in ≥2 of 3 TEST folds **and** raw
avgR > 0 in ≥2 of 3.

| mechanism | test1 | test2 | test3 | result |
|---|---|---|---|---|
| mr-down3 | +0.069 | +0.073 | +0.020 | beats-median 3/3, avgR>0 3/3 → HOLDS |
| gap-fade | −0.001 | +0.029 | +0.084 | beats-median 2/3, avgR>0 2/3 → HOLDS |

These folds had already been read on daily bars while choosing what to look at next, so
passing here was always weaker evidence than it looks. It bought exactly one thing: the
right to write a separate pre-registration and spend the deep hold-out once.

## 3. Deep hold-out, 2000–2016 — both REJECT

Deep panel: `.cache/bars/sp500-1d-deep.json`, 453 symbols, 366,739 weekly bars,
1,481 placeholder bars dropped across 41 symbols. Bar fixed in advance: **beats control
median ≥2/3 AND beats control p95 ≥1/3 AND raw avgR > 0 ≥2/3.**

**mr-down3**

| fold | trades | avgR | ctrl med | margin | verdict |
|---|---|---|---|---|---|
| deep1 | 5346 | 0.085 | **0.124** | −0.039 | loses |
| deep2 | 6386 | 0.107 | **0.113** | −0.006 | loses |
| deep3 | 6845 | 0.192 | **0.169** | +0.023 | beats +p95 |

→ median 1/3, p95 1/3, avgR>0 3/3 → **REJECT**

**gap-fade**

| fold | trades | avgR | ctrl med | margin | verdict |
|---|---|---|---|---|---|
| deep1 | 6595 | 0.009 | −0.038 | +0.047 | beats +p95 |
| deep2 | 7647 | −0.036 | −0.021 | −0.015 | loses |
| deep3 | 12485 | −0.054 | −0.046 | −0.008 | loses |

→ median 1/3, p95 1/3, avgR>0 1/3 → **REJECT**

## 4. The finding that matters more than the verdict

**mr-down3 did not get worse in 2000–2016 — the control got better.** Its own avgR is
positive in all three deep folds (0.085 / 0.107 / 0.192), higher than in test2 (0.071)
where it passed. What changed is the control's own level: the weekly random-entry control
**pays +0.11 to +0.17R** in deep1 and deep2, against −0.002 in test2.

Buying at random on weekly bars during 2000–2016 was profitable, because a long-only rule
on today's S&P 500 members over a 16-year window is mostly measuring the index. A rule that
merely earns that is not an edge.

**Operative rule: never read a margin without reading the control's own level in the same
fold.** A margin of +0.02 over a control paying +0.17 and a margin of +0.02 over a control
paying −0.05 are not the same claim.

## 5. Survivorship diagnostic — also REJECT

449 symbols with ≥1y of deep history, split into quartiles by their own deep-window
annualised return (112/112/112/113 — every symbol in exactly one bucket).

Mean margin over the control median, averaged across the three deep folds:

| quartile | mean margin |
|---|---|
| Q1 (worst compounders, −27.8%..7.2%) | **−0.023** |
| Q2 (7.3%..10.7%) | −0.007 |
| Q3 (10.7%..15.8%) | +0.007 |
| Q4 (best, 15.9%..99.3%) | +0.002 |

Monotone in the wrong direction: positive only where the names compounded. This is the
index's drift, not an edge.

**This diagnostic tests winner DRIFT among survivors only.** Membership survivorship is
untouched by it and stays open — see `docs/quant/2026-09-09-portfolio-capacity.md` §4.

## 6. What is now forbidden

- **Do not re-tune mr-down3 or gap-fade as weekly entries.** A REJECT here closes the
  mechanism on weekly bars. It is not a request for a different ladder, a swept lookback,
  or a fold to drop.
- **Do not spend DEEP1–3 again casually.** They have now been read three times (daily
  mr-down3 2026-09-05; weekly mr-down3 + gap-fade here; weekly indicators, see
  `docs/quant/2026-09-08-weekly-indicator-results.md`). A fourth read is the owner's
  decision, not a researcher's.
- **Do not present "mr-down3 passed a hold-out" without the weekly qualifier.** It passed
  on daily bars (`docs/quant/2026-09-05-deep-holdout.md`) and was rejected on weekly.
