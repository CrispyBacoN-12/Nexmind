# Confluence Filter Sweep — IS/OOS Results

**Run date:** 2026-08-23 · **Cache fetched:** 2026-08-16
**Harness:** `scripts/setup-filter-sweep.mts`
**Universe:** S&P 500, every 3rd symbol (164 requested, 158–161 with enough history)
**Split:** IS < 2023-01-01 ≤ OOS, a calendar cut fixed in the harness before any result existed
**Costs:** `{"slippageBps":0.5,"commissionBps":1}`

## Verdict: all 13 confluence filters REJECTED

Not one filter survives out-of-sample. Every threshold stays `undefined`, which is how they
shipped — `DEFAULT_THRESHOLDS` is unchanged and no live behaviour changes as a result of this
study. The sweep's whole return on investment is negative: it stopped three filters from being
adopted on in-sample noise.

## Disclosure: this run is not fully blind

The sweep was first run at `--interval=1d`, both splits, before anyone noticed that portfolio #11
actually scans `1wk`/`5y` — so the daily table measured a strategy the desk does not trade. The
weekly runs below are the real test, but their author had already seen the daily OOS table, in
which every filter also failed. The three picks were chosen from the weekly IS table alone and
written down before the weekly OOS ran; that ordering was preserved. Still, someone who has
already watched thirteen filters fail on a neighbouring sample is not a blind chooser, and this
is weaker evidence than a first look would have been.

## The picks, chosen from IS alone

Pre-registered from the weekly IS table before the OOS run: **BB %B < 0.70** (biggest ΔavgR,
+0.055, and the best PF at 1.23), **Stoch < 85** (cheapest — keeps 89% of trades), **VWAP side**
(+0.037). All three then failed.

| filter | IS ΔavgR | OOS ΔavgR | outcome |
|---|---|---|---|
| BB %B < 0.70 | **+0.055** | −0.031 | sign flip — REJECTED |
| Stoch < 85 | **+0.026** | −0.021 | sign flip — REJECTED |
| VWAP side | **+0.037** | −0.020 | sign flip — REJECTED |

The other ten were not selected and also fail: no filter has a positive OOS ΔavgR except
`swept first` (+0.145 on **27 trades**, t 0.66, after −0.326 in-sample — noise, not a finding).

## Weekly (1wk) — the timeframe the desk trades

IS, 2073 baseline trades:

```
filter           trades   kept    win%    avgR    ΔavgR    sdR     t       totalR    PF
baseline         2073     100%       26.3   0.076             1.39    2.51   158.4    1.19
BB %B < 0.90     1981     96%        26.4   0.072 -0.005      1.39    2.30   142.4    1.17
BB %B < 0.80     1796     87%        26.9   0.091 +0.014      1.39    2.75   162.6    1.20
BB %B < 0.70     1457     70%        27.5   0.131 +0.055      1.40    3.58   191.4    1.23
BB width > 2%    2073     100%       26.3   0.076 +0.000      1.39    2.51   158.4    1.19
BB width > 4%    2073     100%       26.3   0.076 +0.000      1.39    2.51   158.4    1.19
Stoch < 85       1854     89%        27.1   0.102 +0.026      1.40    3.16   189.9    1.19
Stoch < 75       1458     70%        26.3   0.110 +0.034      1.38    3.05   160.9    1.14
Stoch < 65       1041     50%        23.5   0.001 -0.076      1.35    0.01     0.6    0.89
VWAP side        1643     79%        27.1   0.113 +0.037      1.39    3.30   186.4    1.10
LC agrees        1122     54%        23.4  -0.009 -0.086      1.35   -0.23   -10.3    1.05
in value area    949      46%        23.3  -0.027 -0.103      1.35   -0.61   -25.4    0.96
swept first      41       2%         19.5  -0.250 -0.326      1.30   -1.24   -10.2    0.41
```

OOS, 1135 baseline trades:

```
filter           trades   kept    win%    avgR    ΔavgR    sdR     t       totalR    PF
baseline         1135     100%       25.9   0.044             1.39    1.08    50.5    1.03
BB %B < 0.90     1075     95%        25.6   0.040 -0.004      1.38    0.95    43.1    1.00
BB %B < 0.80     988      87%        24.8   0.004 -0.040      1.37    0.10     4.1    0.96
BB %B < 0.70     823      73%        24.5   0.014 -0.031      1.37    0.29    11.3    1.05
BB width > 2%    1135     100%       25.9   0.044 +0.000      1.39    1.08    50.5    1.03
BB width > 4%    1135     100%       25.9   0.044 +0.000      1.39    1.08    50.5    1.03
Stoch < 85       1050     93%        25.0   0.024 -0.021      1.37    0.55    24.7    0.95
Stoch < 75       863      76%        25.1  -0.019 -0.063      1.38   -0.40   -16.1    0.97
Stoch < 65       645      57%        22.5  -0.074 -0.118      1.34   -1.40   -47.7    0.85
VWAP side        911      80%        24.6   0.024 -0.020      1.37    0.54    22.1    0.92
LC agrees        755      67%        23.4  -0.029 -0.073      1.35   -0.59   -21.8    0.69
in value area    582      51%        21.6  -0.108 -0.153      1.33   -1.97   -63.0    0.94
swept first      27       2%         33.3   0.190 +0.145      1.50    0.66     5.1    0.51
```

## The bigger finding: the baseline is not established either

Trend-pullback's own edge, before any filter:

| interval | split | trades | avgR | sdR | t | PF |
|---|---|---|---|---|---|---|
| 1wk | IS | 2073 | +0.076 | 1.39 | **2.51** | 1.19 |
| 1wk | OOS | 1135 | +0.044 | 1.39 | **1.08** | 1.03 |
| 1d | IS | 9992 | −0.014 | — | — | 0.95 |
| 1d | OOS | 5497 | +0.022 | — | — | 1.00 |

Two things follow.

**The weekly configuration is the right one.** On daily bars the strategy is a coin flip in both
periods (PF 0.95 / 1.00). On weekly it is positive in both. Portfolio #11 is configured `1wk`/`5y`,
so the desk is trading the only timeframe of the two where this rule has ever shown anything.

**But "positive in both" is not the same as "has an edge."** The OOS weekly t-statistic is 1.08.
At n=1135 with sd 1.39 the standard error on avgR is 0.041, so +0.044 is one standard error from
zero — the held-out result cannot reject "no edge at all," and the IS t of 2.51 is itself modest
for a sample that was never held out from the rule's own design. The edge, if real, is around
+0.04R per trade and needs several more years of forward data to separate from noise.

That is the number every future claim about this desk has to beat. It is also why the
counterfactual arms (`src/lib/trading/counterfactual.ts`) matter more than any filter: if the
analysts cannot add to a +0.04R baseline, there is nothing here to go live with.

## What was NOT done

- No filter threshold was changed. `DEFAULT_THRESHOLDS` is byte-identical.
- The symbol stride is 3 (164 of 491 symbols). A full-universe run would tighten the error bars
  by ~1.7×; it would not turn a sign flip into a confirmation.
- Intraday (`1h`) was not swept — the cache holds daily bars only, and weekly is what the desk
  is configured on.
