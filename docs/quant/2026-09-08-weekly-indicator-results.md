# Classic indicators as standalone weekly entries — results and REJECT

**Scripts (pre-registered, already run — never edit):** `scripts/weekly-indicator-screen.mts`
(`c363eaf`), `scripts/weekly-indicator-test-rows.mts`,
`scripts/weekly-indicator-deep-holdout.mts` (`9fa298b`)
**Logs:** `scripts/weekly-indicator-screen.log`, `scripts/weekly-indicator-test-rows.log`,
`scripts/weekly-indicator-deep-holdout.log`

**Verdict: rsi-band (RSI 30/70) and bb-revert (Bollinger 20,2) are both REJECTED.** They
beat their random-entry control in almost every fold **while losing money in every one of
them.** This is the cleanest example the project has of why the control is a necessary
check and not a sufficient one.

## Why this ran

The question was whether the six textbook indicators — ADX, MACD, EMA cross, RSI,
Bollinger, Stochastic — do anything as *standalone* weekly entries. Every parameter is a
library default and every threshold is the textbook one: ADX(14) > 25, MACD(12,26,9),
EMA(20)/EMA(50), RSI(14) 30/70, Bollinger(20, 2σ), Stochastic %K(14,3,3) 20/80. **No number
here was chosen by looking at a result**, which is the only reason six rules on two folds is
readable at all.

Same harness as the mechanism screen: weekly bars resampled from `.cache/bars/sp500-1d.json`
with per-bar assertion, livable next-open fill, `ladder=flat tp1=1.2 sl=1.5`, 200-run
control, `seed=20260825`.

## 1. Screen, fit + select

| indicator | fit avgR | fit margin | select avgR | select margin | verdict |
|---|---|---|---|---|---|
| rsi-band | −0.156 | +0.019 | −0.094 | +0.329 | **ADVANCES** |
| bb-revert | −0.089 | +0.018 | −0.037 | +0.217 | **ADVANCES** |
| stoch-revert | −0.108 | −0.002 | −0.014 | +0.264 | out (fit) |
| adx-trend | +0.103 | +0.015 | −0.041 | −0.231 | out (select) |
| ema-cross | +0.031 | +0.038 | −0.025 | −0.157 | out (select) |
| macd-cross | −0.046 | −0.029 | +0.024 | −0.010 | out (both) |

Note the shape of the two that advanced: **their own avgR is negative in both folds.** The
margin is large because the control is even worse — RSI's select control median is −0.423.
The screen's promotion bar only asked for the margin, so they advanced.

## 2. TEST rows

Criterion: beats control median ≥2/3 **and** raw avgR > 0 ≥2/3.

| indicator | test1 | test2 | test3 | avgR>0 |
|---|---|---|---|---|
| rsi-band | +0.253 (avgR +0.025) | +0.251 (+0.130) | +0.098 (−0.097) | 2/3 |
| bb-revert | +0.140 (+0.013) | +0.194 (+0.140) | +0.091 (−0.020) | 2/3 |

Both clear it — 3/3 on the margin, 2/3 on the sign, scraping past on test1's thin positive.

## 3. The bar was raised before the deep hold-out ran

Before spending DEEP1–3 a third time, the owner was asked what the pass bar should be and
chose **the same bar plus a mandatory `avgR > 0` in ≥2 of 3 folds.** That decision was made
before any deep row was computed, and it is the entire difference between this being a
REJECT and a PASS.

Both rules were also predicted to fail, in writing, in the script's own header.

## 4. Deep hold-out, 2000–2016 — both REJECT

**rsi-band**

| fold | trades | avgR | ctrl med | margin | verdict |
|---|---|---|---|---|---|
| deep1 | 4479 | **−0.091** | −0.157 | +0.066 | beats +p95 |
| deep2 | 5097 | **−0.055** | −0.108 | +0.053 | beats +p95 |
| deep3 | 7804 | **−0.128** | −0.203 | +0.075 | beats +p95 |

→ median 3/3, p95 3/3, **avgR>0 0/3** → **REJECT**

**bb-revert**

| fold | trades | avgR | ctrl med | margin | verdict |
|---|---|---|---|---|---|
| deep1 | 6555 | **−0.068** | −0.094 | +0.026 | beats +p95 |
| deep2 | 7430 | **−0.080** | −0.059 | −0.021 | loses |
| deep3 | 9544 | **−0.092** | −0.120 | +0.028 | beats +p95 |

→ median 2/3, p95 2/3, **avgR>0 0/3** → **REJECT**

## 5. rsi-band is the strongest negative result in the project

It is worth stating plainly, because it is the one someone will be tempted to reopen:

- It beat the control **median in 3 of 3** deep folds and the control **p95 in 3 of 3** —
  no other rule the project has measured has done that on DEEP1–3.
- Its survivorship quartiles are **flat and positive**: Q1 +0.056, Q2 +0.085, Q3 +0.063,
  Q4 +0.062. The winner-drift objection **falls** — the rule works on the worst compounders
  too, which is more than mr-down3 could say.
- And it **loses money in every fold it has ever been measured in.** avgR is negative in
  fit, select, test3, deep1, deep2 and deep3.

What RSI 30/70 has is a real, robust, survivorship-clean ability to pick bars that fall
slightly less than random bars fall. That is not a strategy. Selling it as one would mean
trading a rule with a negative expectancy because its *relative* number is good.

bb-revert's quartiles behave the ordinary way — Q1 −0.020 against Q4 +0.027 — so it fails
the survivorship rule as well as the money rule.

## 6. What is now forbidden

- **Do not re-tune RSI 30/70 or Bollinger(20,2) as weekly standalone entries.** Not a
  different band, not a different lookback, not a different ladder, not a fold dropped.
- **Do not quote "beats the control p95 3/3" for rsi-band without the avgR line beside it.**
  Split from its sign, that number is actively misleading.
- **Do not treat "the winner-drift objection falls" as "survivorship is handled".** It says
  the effect is not concentrated in the compounders. Membership survivorship is a different
  bias and remains open and unmeasurable with this data —
  see `docs/quant/2026-09-09-portfolio-capacity.md` §4.
