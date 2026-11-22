# Short sweep replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pre-registered PASS/REJECT for `sweep-short-v1` (the mirrored long sweep) on below-trend sessions 2016 to now, against random shorts. The same sessions also get the long sweep's numbers, as information.

**Architecture:**
- The short rule is the long pipeline run on price-mirrored data. A candle becomes `{o:-o, h:-l, l:-h, c:-c}`, and the levels are negated with their names swapped (H↔L).
- `findSetup`, `scoreSetup` and the control code are reused unchanged. Only R is recomputed with a short-side cost formula.
- `runReplay` gains optional `side`, `pickSessions` and `ruleVersion` inputs. A new script fetches only the below-trend windows and runs both sides.

**Tech Stack:** TypeScript, node:test via `npx tsx --test`, Alpaca bars (`fetchAlpacaRange`).

**Spec:** docs/superpowers/specs/2026-11-22-sweep-short-replay-design.md

## Global Constraints

- **Live code unchanged.** The long `findSetup`, `scoreSetup` and `CHART_RULE_VERSION` keep identical behaviour, and every existing test still passes. No change to the chart agent's live run, `/advisor`, `/scan`, the nightly scorer, or Discord.
- **No new parameters.** Every constant is the live one.
- **PASS** if and only if the hold mean R is above the control's p95 AND at least 100 trades closed. Otherwise REJECT ("too few trades" is a REJECT).
- **Regime:** a session counts when, as of its previous session on adjusted SPY daily bars, it is NOT `close > SMA200`. A session where the gate would read BLIND is skipped.
- **Short R:**
  - `entryPx = fill × (1 − s)`
  - `exitPx = exit × (1 + s)`
  - `R = (entryPx − exitPx − c × entryPx) / (stop − entryPx)`
  - `s` = slippageBps / 1e4 and `c` = commissionBps / 1e4, from `SCORECARD_COST_MODEL`.
  - No borrow fee, short-sale restriction or dividend-owed cost.
- **Labels:** the short run is `sweep-short-v1`, and the long comparison is `sweep-v1 (below-trend sessions)`.
- **Writes:** no DB writes. Results go to `docs/quant/<run date>-sweep-short-replay.md`, and the bar cache goes under `.cache/scorecard-short/`.

## Review Focus

1. Level-name swap in the mirror (PDH↔PDL, PMH↔PML, pVAH↔pVAL; dPOC and pPOC kept): a wrong swap silently tests a different rule. Pinned in Task 1.
2. Commission sign on short R. Negating prices inside the long `rMultiple` would turn commission into a credit. Pinned in Task 1.
3. The regime filter must read the previous session, not the same day's close. Pinned in Task 2.
4. Run through `controlDistribution`, a mirrored trade must score short R, not the long `rMultiple` on negative prices. Pinned in Task 2.
5. The long replay output must be unchanged when the new inputs are omitted. Pinned in Task 3.

---

### Task 1: Price mirror and short R

**Files:**
- Create: `src/lib/scorecard/shortMirror.ts`, `src/lib/scorecard/shortMirror.test.ts`

**Interfaces:**
- Produces:
  - `mirrorCandles(c: Candle[]): Candle[]`
  - `mirrorSplit(s: SessionSplit): SessionSplit`
  - `mirrorLevels(l: Levels): Levels`
  - `shortRMultiple(fill: number, exit: number, stop: number, costs?: CostModel): number`
    (`fill`, `exit` and `stop` are real, positive prices)
  - `scoreMirrored(input: ScoreInput): Outcome`
    - `input` is in mirrored space: the bars are mirrored, and stop and t1 are negated.
    - It returns `scoreSetup(input)` with `r` replaced by `shortRMultiple(-fill, -exitPrice, -input.stop)` when closed.
    - The other fields stay in mirrored space; callers read only `status`, `r`, `fill` (for null) and `exitReason`.

- [ ] **Step 1: Failing tests**
  - `"mirrorCandles negates and swaps high/low"`: `{t:1,o:10,h:12,l:9,c:11,v:5}` → `{t:1,o:-10,h:-9,l:-12,c:-11,v:5}`.
  - `"mirrorLevels swaps H/L names and negates"`: PDH 12, PDL 9, PMH 11, PML 9.5, pVAH 11.5, pVAL 9.8, pPOC 10.5, dPOC 10.2 (null kept null) → PDH −9, PDL −12, PMH −9.5, PML −11, pVAH −9.8, pVAL −11.5, pPOC −10.5, dPOC −10.2.
  - `"shortRMultiple: zero costs is (fill-exit)/(stop-fill)"`: `shortRMultiple(100, 98, 101, {slippageBps:0, commissionBps:0}) === 2`.
  - `"shortRMultiple: costs make it worse, never better"`: with `SCORECARD_COST_MODEL`, the value is < 2 at the same prices, and at exit = stop it is < −1.
  - `"findSetup on mirrored data finds the short sweep"`: build a regular session.
    - Inputs: PDH 101; a bar with o 100.5, h 101.4, l 100.3, c 100.6; later closes below 101; PDL 97 below.
    - Run `findSetup(t, mirrorSplit(split), mirrorLevels(levels), atr)`.
    - Expect kind "setup", `-setup.entry` = the last close, `-setup.stop` = 101.4 + `CHART_STOP_BUFFER_ATR` × atr, and `-setup.t1.price` the highest target level below the entry.
  - `"scoreMirrored: stop on a later high, t1 on a later low, both-touched counts as stop, gap above stop fills at open"`. Four cases on mirrored bars:
    - A stop hit gives r = `shortRMultiple(fill, stop, stop)`.
    - A T1 hit gives r = `shortRMultiple(fill, t1, stop)`.
- [ ] **Step 2:** `npx tsx --test src/lib/scorecard/shortMirror.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** in `shortMirror.ts`. The level swap map is `{PDH:"PDL", PDL:"PDH", PMH:"PML", PML:"PMH", pVAH:"pVAL", pVAL:"pVAH", pPOC:"pPOC", dPOC:"dPOC"}`. The new value at name N is the negated old value at swap(N).
- [ ] **Step 4:** Run the tests → PASS.
- [ ] **Step 5:** Commit `feat(replay): price mirror and short R for the short sweep replay`.

### Task 2: Regime filter and injectable control scorer

**Files:**
- Create: `src/lib/scorecard/replayRegime.ts`, `src/lib/scorecard/replayRegime.test.ts`
- Modify: `src/lib/scorecard/control.ts` (`controlDistribution`), and its test file

**Interfaces:**
- Produces:
  - `belowTrendSessions(spyDaily: Candle[], sessions: string[]): string[]`
    - For each session, take SPY bars dated strictly before it and run `gateSlots(prior, 1)`.
    - Keep the session when `benchAbove === false`.
    - Skip it when `benchAbove === null` (BLIND) or `true`.
  - `controlDistribution(trades, variant, runs?, seed?, score: (i: ScoreInput) => Outcome = scoreSetup)`.
- [ ] **Step 1: Failing tests**
  - `"belowTrendSessions reads the previous session only"`:
    - SPY: 200 flat bars at 100, then 99 on day D, then 120 on day D+1, then a bar on D+2.
    - Call it with sessions `[D+1, D+2]` → `[D+1]`.
      - D+1: the prior close 99 is below SMA 99.995.
      - D+2: the prior close 120 is above SMA 100.095, even though D+2's own bar is irrelevant.
    - A variant where D+2's own close is 50 must still give `[D+1]`, which proves no same-day read.
  - `"belowTrendSessions skips BLIND (under 200 prior bars)"` → `[]`.
  - `"controlDistribution uses the injected scorer"`:
    - Pass a mirrored trade.
    - Run it once with `scoreMirrored` and once with the default.
    - The median R differs, and the injected result equals a hand-computed `shortRMultiple` for a deterministic single-bar pool.
  - The existing control tests are unchanged (the default is preserved).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (one extra parameter; nothing else in `control.ts` changes). **Step 4:** Run with `src/lib/scorecard/control.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(replay): below-trend session filter; control takes an injectable scorer`.

### Task 3: `runReplay` side, pick sessions and per-year stats

**Files:**
- Modify: `src/lib/scorecard/replay.ts` (`ReplayDeps`, `ReplaySummary`, pass 3, return)
- Modify: `src/lib/scorecard/replay.test.ts`

**Interfaces:**
- Consumes: Task 1 (`mirrorSplit`, `mirrorLevels`, `mirrorCandles`, `scoreMirrored`) and Task 2 (`controlDistribution` score parameter).
- Produces:
  - `ReplayDeps`:
    - `side?: "long" | "short"` (default "long")
    - `pickSessions?: string[]` (setups only on these; ranking and scoring still use every `sessions` date)
    - `ruleVersion?: string` (default `CHART_RULE_VERSION`)
    - `extraBiases?: string[]`
  - `ReplaySummary`:
    - `side: "long" | "short"`
    - `byYear: Record<string, { n: number; meanR: number | null }>` (closed hold trades by setup-session year)
- [ ] **Step 1: Failing tests** (reuse the existing replay test fixtures):
  - `"defaults reproduce the long replay"`: the existing fixture's summary with no new inputs deep-equals the same run with `side:"long"`, and every pre-existing assertion still holds.
  - `"pickSessions limits setups but not scoring"`: two sessions both with a long setup, and `pickSessions = [the first]` → `setupsFound === 1`.
  - `"short side finds the mirrored setup and reports short R"`:
    - Fixture: the mirror of an existing long-setup fixture, built by mirroring the fixture bars before handing them to `loadIntraday` and `loadDaily`.
    - Run with `side:"short"`.
    - Expect `setupsFound` and `stats.hold.meanR` equal to the long run on the original fixture within 1e-9, and `ruleVersion` as passed.
    - Costs are symmetric under the formula, so this holds exactly.
  - `"byYear groups closed hold R by setup year"`.
- [ ] **Step 2:** Run `npx tsx --test src/lib/scorecard/replay.test.ts` → FAIL.
- [ ] **Step 3: Implement:**
  - In pass 3, when `side === "short"`, run on the mirrored split, levels and scoring bars.
  - Score with `scoreMirrored`, and pass the mirrored `fill`, `stop` and `t1` into control trades with `score = scoreMirrored`.
  - Filter picks by `pickSessions` before the setup step.
- [ ] **Step 4:** Run → PASS, then `npx tsc --noEmit` passes clean.
- [ ] **Step 5:** Commit `feat(replay): short side, pick-session filter and per-year stats`.

### Task 4: Replay script (below-trend windows only)

**Files:**
- Create: `scripts/sweep-short-replay.mts`

**Interfaces:**
- Consumes: Task 2 `belowTrendSessions` and Task 3 `runReplay` with the new deps.
- Produces: `.cache/scorecard-short/result.json` holding `{ short: ReplaySummary, long: ReplaySummary, windows: [from, to][], belowSessions: number }`.

- [ ] **Step 1: Write the script:**
  - Fetch SPY adjusted daily from 2015-01-01 to the last complete session.
  - `all` = the SPY dates ≥ 2016-01-04, and `below` = `belowTrendSessions(spy, all)`.
  - Windows: each run of below-trend sessions, padded 15 sessions before and 12 after on the `all` index, with overlaps merged.
  - Universe: `UNIVERSES.sp500Current`.
  - Per ticker and per window, cache `<T>.<from>_<to>.{5m,1d,1draw}.json` and keep 5-minute bars between 04:00 and 16:00 ET only.
    - The 5m and 1d fetches cover [window start − 5 calendar days, window end].
    - The daily and raw daily fetches start 60 calendar days earlier (ATR lookback).
  - Loaders concatenate the windows in time order.
  - `sessions` = all `all` dates inside the padded windows; `pickSessions` = `below`.
  - Run the short side (`ruleVersion: "sweep-short-v1"`) and the long side (`"sweep-v1 (below-trend sessions)"`).
  - `extraBiases`:
    - survivorship favours longs
    - no borrow fee, short-sale restriction or dividend owed
  - `--allow-missing` behaves as in `scorecard-replay.mts`.
  - Print, for each side: n closed, mean R, the control median and p95, the verdict per the Global Constraints, and `byYear`.
- [ ] **Step 2: Smoke run** on one window and 5 tickers (`--smoke` flag: first window, first 5 tickers, no result file). Expected: it prints both summaries without throwing.
- [ ] **Step 3:** Commit `feat(replay): short sweep replay script over below-trend windows`.

### Task 5: Full run and results

**Files:**
- Create: `docs/quant/<run date>-sweep-short-replay.md`
- Modify: `docs/STATE.md` (one line), plus the memory note

- [ ] **Step 1:** Run the full script in the background: `node --env-file=.env --import tsx scripts/sweep-short-replay.mts`. Expected: the result file is written; any missing tickers are listed.
- [ ] **Step 2: Write the results doc:**
  - the verdict, applying the Global Constraints rule literally
  - the table for both sides (n, mean R, win %, the control median and p95, `byYear`)
  - the windows and the number of below-trend sessions
  - the biases
  - the command used
- [ ] **Step 3:** Add a STATE.md line with the verdict and the doc path. Commit `docs(quant): sweep-short-v1 replay verdict`.
