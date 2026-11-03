# sweep-v1 replay: 3 years, code rule only: REJECT

Date: 2026-11-03. Pre-registered in `docs/superpowers/specs/2026-11-03-scorecard-agent-design.md` §6–§7. Not re-cut.
Stored once as `ScorecardSnapshot` kind `replay`, ruleVersion `sweep-v1`. Shown on `/scorecard`.

## Question

The chart agent (agent #2) finds long liquidity-sweep setups on 5-minute bars. If every setup the code rule found had
been bought, would the result beat buying the same names at random times? The AI's keep/veto is not part of this
test. The AI is measured forward (agent #4's nightly job), because replaying it on old charts would leak hindsight.

## Method

- **Period:** 2023-11-03 to 2026-11-02, 751 sessions. The last 9 sessions are excluded so every 10-session hold
  window fits inside the period.
- **Universe and ranking:**
  - The universe is the fixed approximate S&P 500 list `/scan` uses: 490 names, all with data.
  - Each session at 10:30 ET, the scan's own filter (`passesBase` and at least one trigger) and its `activityScore`
    order picked the top 20, using only bars that had ended by 10:30 − 16 min.
  - Ranking used the as-traded basis (raw daily volume and price), so a later stock split cannot lift a name over a
    floor.
  - That gave 13,380 picks.
- **Setups:** the live `splitSessions → computeLevels → findSetup` code with the live daily-ATR rule.
  - 1,453 setups were found.
  - 252 were not filled: the first open at or after 10:30 was already ≤ stop or ≥ T1.
  - 1,201 were scored. None was still open at the end.
- **Fill and exits (spec §5):**
  - Fill is the open of the first regular 5-minute bar at or after 10:30.
  - Primary exit: hold until the stop or T1, capped at 10 sessions. A gap through a level exits at the open, and a
    bar touching both levels counts as the stop.
  - Secondary exit: the same rules, but close at the end of the entry day.
- **Costs:** 5 bps slippage on every fill plus 1 bp round-turn commission (`RESEARCH_COST_MODEL`).
- **Control:**
  - Per setup, a random regular-bar entry on the same ticker and session, between 10:30 and 15:30 ET.
  - The same stop distance and the same T1 multiple in R. Same exits, same costs.
  - 200 runs, seed `PANEL_SEED`.
- **Runtime:** 81.7 minutes, with no fetch warnings. A first attempt was stopped after a stack-overflow bug in
  `fetchAlpacaRange` skipped the 5 largest tickers (fixed in `a0eea87`; the missing-data guard would have refused
  to store a partial result).

## Result

| | n | mean R | win % | T1 before stop % |
|---|---|---|---|---|
| **Hold to stop/T1 (primary)** | 1,201 | **−0.085** | 47.9% | 49.8% |
| Close same day | 1,201 | −0.093 | 48.3% | 35.5% |
| Random control (primary), median of 200 runs | | −0.055 | | |
| Random control (primary), p95 of 200 runs | | +0.001 | | |

Cumulative: −102.4 R over 1,201 trades.

**Verdict: REJECT (ไม่ผ่าน).** The bar was a mean R above the control's p95. The rule's mean is not only below the
p95: it is 0.03 R *below the random median*. Buying the same names at random times on the same days did better than
buying the sweep.

## Reading it

- **Costs explain the control's negative median.** Sweep stops are tight, often under 0.5 × ATR, so 5 bps per fill is
  a large share of 1R. That hits the control equally and mostly cancels out of the margin. The margin is still
  negative.
- **Win rate is beside the point.** About half the trades reach T1 first, yet the mean is negative.
- **This matches every earlier sweep result.** Gold's xau-vp-v1 sweep lost money in every fold (`2026-10-30-xau-vp-v1-results.md`).

## Biases (stored verbatim with the snapshot)

1. **Survivorship.** The universe is the fixed ~490-name list `/scan` uses. It includes some names that left the
   index, lacks recent additions, and names that stopped trading are absent.
2. **Missing ranking inputs.** Historical earnings and 8-K inputs to the scan's ranking are unavailable and count 0.

Neither bias is likely to flip a result that sits below the random median.

## What this does and does not say

- It says the **code rule**, traded mechanically, has no edge over random entries on these names. That holds for
  both exits.
- It does **not** judge the AI's veto. Agent #4's forward record does that: the first 300 setups the AI keeps,
  frozen once (spec §6). A veto that removes the worst setups could still lift the kept group above its own control.
  But it would be filtering a rule whose raw output loses to random.
- Do not re-tune the sweep rule from this result. A changed rule is a new `CHART_RULE_VERSION` and needs its own
  pre-registration (STATE §5).
