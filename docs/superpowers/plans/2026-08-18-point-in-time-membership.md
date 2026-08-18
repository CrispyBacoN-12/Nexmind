# Point-in-Time S&P 500 Membership + Re-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove look-ahead survivorship bias from NEXMIND's two cross-sectional US-equity mechanisms (mean reversion, momentum) by gating candidate eligibility on real point-in-time S&P 500 membership instead of today's static list, then re-run both already-rejected mechanisms against the corrected universe with identical gates/thresholds/seeds.

**Architecture:** A new pure module, `src/lib/backtest/crossSectional/membership.ts`, parses a vendored point-in-time membership CSV into a `(symbol, day) -> boolean` lookup. Both existing cross-sectional engines (`crossSectionalBacktest`, `buildSnapshots`) gain an optional third parameter of that exact shape, threaded into their existing candidate-selection loops. A one-off fetch script vendors the CSV to `.cache/` (gitignored, same discipline as `.cache/bars/*.json`). The two mechanisms are then re-run — mean reversion via CLI-flag-gated edits to the existing sweep/walk-forward scripts, momentum via a new dedicated re-run script that leaves the original untouched — producing two new, separately dated results docs.

**Tech Stack:** TypeScript, `tsx`, Node's built-in `node:test` + `assert/strict`, native `fetch` (Node 20+), no new dependencies.

## Global Constraints

- Omitting the new `isMember` parameter at either `crossSectionalBacktest` or `buildSnapshots` must reproduce today's output bit-for-bit — every existing caller and every existing test omits it.
- `src/lib/backtest/crossSectional/membership.ts` is pure: no `node:fs`, no `fetch`, no `process.env`, no `Date.now()`/`Math.random()`. It only parses a string and returns a lookup function.
- Vendoring, not live-fetching: only `scripts/fetch-sp500-membership.mts` touches the network. Backtests and re-run scripts read `.cache/sp500-membership.csv` from disk. `.cache/` is already gitignored (`.gitignore:81`) — the fetched CSV itself is never committed, only the fetch script.
- Dow 30 is out of scope: no point-in-time table is built for it, and the mean-reversion re-run's universe-haircut gate leaves `dow30`/`nasdaq100` ungated on purpose (see Task 5).
- Source CSV: `fja05680/sp500`, exact URL `https://raw.githubusercontent.com/fja05680/sp500/master/S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv` — `master` branch (not `main`). Format: header `date,tickers`, then rows `YYYY-MM-DD,"TICK1,TICK2,...,TICKn"`. No `TICKER-YYYYMM` suffixes exist in this file (verified by direct fetch) — the parser does no suffix-stripping.
- Test command for a single file: `npx tsx --test path/to/file.test.ts`. Full suite: `npm test` (`tsx --test "src/**/*.test.ts"`).
- Git: stage exact file paths only, never `-A`/`.`/`-a`. Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- This work fixes look-ahead bias only for symbols already in `.cache/bars/sp500-1d.json`. It does not restore names that left the S&P 500 before that cache was ever built (no price series exists for them) — that remains a separate, out-of-scope data-acquisition gap.

---

### Task 1: Membership CSV parsing + point-in-time index

**Files:**
- Create: `src/lib/backtest/crossSectional/membership.ts`
- Test: `src/lib/backtest/crossSectional/membership.test.ts`

**Interfaces:**
- Consumes: `dayKey` from `./calendar` (existing, `dayKey(t: number): number = Math.floor(t / 86_400)`).
- Produces:
  ```ts
  export interface MembershipSnapshot { day: number; members: Set<string> }
  export function parseMembershipCsv(csv: string): MembershipSnapshot[];
  export function buildMembershipIndex(snapshots: MembershipSnapshot[]): (symbol: string, day: number) => boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/backtest/crossSectional/membership.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMembershipCsv, buildMembershipIndex } from "./membership";
import { dayKey } from "./calendar";

// Real add/drop pattern pulled from fja05680/sp500's "S&P 500 Historical
// Components & Changes (Updated).csv" (verified by direct fetch): TSLA joins
// 2020-12-21; ATVI's last appearance is 2023-10-02, first confirmed absence
// 2023-10-18. Rows are trimmed to a handful of tickers each; only the dates
// and the add/drop shape are load-bearing.
const FIXTURE_CSV = `date,tickers
1996-01-02,"AAPL,ABT,AAL"
2020-12-04,"AAPL,ABT,MSFT"
2020-12-21,"AAPL,ABT,MSFT,TSLA"
2023-10-02,"AAPL,ABT,MSFT,TSLA,ATVI"
2023-10-18,"AAPL,ABT,MSFT,TSLA"
`;

function dayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return dayKey(Date.UTC(y, m - 1, d) / 1000);
}

test("parseMembershipCsv reads one snapshot per row, skipping the header", () => {
  const snapshots = parseMembershipCsv(FIXTURE_CSV);
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].day, dayOf("1996-01-02"));
  assert.deepEqual([...snapshots[0].members].sort(), ["AAL", "AAPL", "ABT"]);
});

test("parseMembershipCsv strips the quotes around the ticker list", () => {
  const snapshots = parseMembershipCsv(FIXTURE_CSV);
  for (const s of snapshots) for (const m of s.members) assert.ok(!m.includes('"'));
});

test("buildMembershipIndex: TSLA is not a member before it joined", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("TSLA", dayOf("2020-12-04")), false);
  assert.equal(isMember("TSLA", dayOf("2020-12-21")), true);
});

test("buildMembershipIndex: ATVI stops being a member on its removal snapshot", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("ATVI", dayOf("2023-10-02")), true);
  assert.equal(isMember("ATVI", dayOf("2023-10-18")), false);
  // A day strictly between two snapshots uses the LATEST snapshot <= that day.
  assert.equal(isMember("ATVI", dayOf("2023-10-02") + 5), true);
});

test("buildMembershipIndex: a day before the first snapshot has no members", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("AAPL", dayOf("1996-01-02") - 1), false);
});

test("buildMembershipIndex: a day after the last snapshot uses the latest snapshot (today's behaviour)", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("TSLA", dayOf("2023-10-18") + 1000), true);
  assert.equal(isMember("ATVI", dayOf("2023-10-18") + 1000), false);
});

test("buildMembershipIndex sorts out-of-order input snapshots before querying", () => {
  const shuffled = [...parseMembershipCsv(FIXTURE_CSV)].reverse();
  const isMember = buildMembershipIndex(shuffled);
  assert.equal(isMember("TSLA", dayOf("2020-12-21")), true);
  assert.equal(isMember("TSLA", dayOf("2020-12-04")), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossSectional/membership.test.ts`
Expected: FAIL — `membership.ts` does not exist / `parseMembershipCsv` is not defined.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/backtest/crossSectional/membership.ts
// Point-in-time S&P 500 membership, vendored from fja05680/sp500 by
// scripts/fetch-sp500-membership.mts (see .cache/sp500-membership.csv). Pure
// parsing + lookup — no I/O here; that discipline is what lets this run
// inside a backtest without a network call.
import { dayKey } from "./calendar";

export interface MembershipSnapshot {
  /** dayKey of the snapshot date — the same integer day both cross-sectional engines use. */
  day: number;
  members: Set<string>;
}

/**
 * Parses the fja05680/sp500 "Updated" CSV: a `date,tickers` header, then one
 * row per snapshot as `YYYY-MM-DD,"TICK1,TICK2,...,TICKn"`. The quoted field
 * is a plain comma list — no ticker in the source contains a literal comma —
 * so this is a fixed two-column split, not a general CSV parser.
 */
export function parseMembershipCsv(csv: string): MembershipSnapshot[] {
  const lines = csv.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const snapshots: MembershipSnapshot[] = [];
  for (const line of lines.slice(1)) {
    const comma = line.indexOf(",");
    const dateStr = line.slice(0, comma);
    let rest = line.slice(comma + 1);
    if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
    const [y, m, d] = dateStr.split("-").map(Number);
    snapshots.push({
      day: dayKey(Date.UTC(y, m - 1, d) / 1000),
      members: new Set(rest.split(",").filter((t) => t.length > 0)),
    });
  }
  return snapshots;
}

/**
 * A `symbol`/`day` lookup against the latest snapshot on or before `day`.
 * Binary search, not a linear scan: this runs once per candidate per day
 * across a multi-year study. A day before the first snapshot has no members
 * (defined, not a crash); a day after the last snapshot uses that last
 * snapshot, i.e. today's "current membership" behaviour.
 */
export function buildMembershipIndex(
  snapshots: MembershipSnapshot[],
): (symbol: string, day: number) => boolean {
  const sorted = [...snapshots].sort((a, b) => a.day - b.day);

  return (symbol: string, day: number) => {
    let lo = 0;
    let hi = sorted.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].day <= day) {
        at = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return at === -1 ? false : sorted[at].members.has(symbol);
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossSectional/membership.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/crossSectional/membership.ts src/lib/backtest/crossSectional/membership.test.ts
git commit -m "$(cat <<'EOF'
feat(quant): add point-in-time S&P 500 membership index

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Vendoring script — fetch the point-in-time membership CSV

**Files:**
- Create: `scripts/fetch-sp500-membership.mts`

**Interfaces:**
- Consumes: `parseMembershipCsv`, `buildMembershipIndex` from `@/lib/backtest/crossSectional/membership` (Task 1).
- Produces: `.cache/sp500-membership.csv` on disk, consumed by Tasks 5 and 6.

No test file — matches the existing `scripts/cache-daily-bars.mts` precedent (no test; verified by running it and inspecting output). This script self-verifies by re-parsing its own freshly-written output and checking it against the same real, verified spot-check dates used in Task 1.

- [ ] **Step 1: Write the script**

```ts
// scripts/fetch-sp500-membership.mts
// One-off vendoring fetch: downloads fja05680/sp500's point-in-time S&P 500
// membership CSV to disk. Backtests and re-run scripts read only the cached
// file — this is the only place in the membership feature that touches the
// network. Re-run by hand to refresh; nothing else triggers it.
//
// Usage: npx tsx scripts/fetch-sp500-membership.mts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";

const URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/" +
  "S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv";
const OUT = ".cache/sp500-membership.csv";

const res = await fetch(URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const csv = await res.text();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, csv);
console.log(`wrote ${OUT} (${csv.length} bytes)`);

const snapshots = parseMembershipCsv(csv);
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const dayOf = (isoStr: string) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000 / 86_400);
};

console.log(`\n${snapshots.length} snapshots, ${iso(snapshots[0].day)} .. ${iso(snapshots[snapshots.length - 1].day)}`);

const isMember = buildMembershipIndex(snapshots);
const spotChecks: [string, string, boolean][] = [
  ["TSLA", "2020-12-04", false],
  ["TSLA", "2020-12-21", true],
  ["ATVI", "2023-10-02", true],
  ["ATVI", "2023-10-20", false],
];
console.log("\n--- spot checks ---");
let allPass = true;
for (const [symbol, date, expected] of spotChecks) {
  const actual = isMember(symbol, dayOf(date));
  const pass = actual === expected;
  if (!pass) allPass = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${symbol} on ${date}: expected ${expected}, got ${actual}`);
}
if (!allPass) {
  throw new Error("spot check failed — the CSV format may have changed; inspect .cache/sp500-membership.csv by hand");
}
```

- [ ] **Step 2: Run it and confirm real output**

Run: `npx tsx scripts/fetch-sp500-membership.mts`
Expected: prints `wrote .cache/sp500-membership.csv (... bytes)`, a snapshot-count line, and four `PASS` spot-check lines, without throwing.

- [ ] **Step 3: Commit**

Only the script is committed — `.cache/sp500-membership.csv` is gitignored, matching `.cache/bars/*.json`.

```bash
git add scripts/fetch-sp500-membership.mts
git commit -m "$(cat <<'EOF'
feat(quant): vendor point-in-time S&P 500 membership fetch script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `crossSectionalBacktest` membership gate (mean reversion engine)

**Files:**
- Modify: `src/lib/backtest/crossSectional/engine.ts`
- Test: `src/lib/backtest/crossSectional/engine.test.ts` (append; do not alter any existing test)

**Interfaces:**
- Consumes: nothing new imported — the parameter is typed inline as `(symbol: string, day: number) => boolean`, matching what `buildMembershipIndex` (Task 1) returns, without engine.ts needing to import membership.ts.
- Produces: `crossSectionalBacktest(bars: Map<string, Candle[]>, cfg: CsConfig, isMember?: (symbol: string, day: number) => boolean): CsResult` — the third parameter is new; everything else about the signature and return type is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/backtest/crossSectional/engine.test.ts` (it already defines `DAY`, `series`, `risingBase`, `cfg` at the top of the file — reuse them, do not redefine):

```ts
test("isMember excludes a non-member symbol from candidate selection", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // same dip as the causality test above; signal fires on day 255
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  // AAA is not a member on the signal day (255) — only from day 256 on, one
  // day too late to ever be seen as a candidate for this particular dip.
  const isMember = (symbol: string, d: number) => symbol === "AAA" && d >= 256;
  const res = crossSectionalBacktest(bars, cfg, isMember);
  assert.equal(res.trades.length, 0);
});

test("isMember admits a member symbol exactly as the unguarded engine would", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const isMember = () => true;
  const res = crossSectionalBacktest(bars, cfg, isMember);
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].entryT, 256 * DAY);
});

test("omitting isMember reproduces today's behaviour bit-for-bit", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const withUndefined = crossSectionalBacktest(bars, cfg, undefined);
  const withoutParam = crossSectionalBacktest(bars, cfg);
  assert.deepEqual(withUndefined, withoutParam);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossSectional/engine.test.ts`
Expected: FAIL — `crossSectionalBacktest` does not accept a third argument yet (TypeScript error) and/or the exclusion test finds 1 trade instead of 0.

- [ ] **Step 3: Add the parameter and the guard**

In `src/lib/backtest/crossSectional/engine.ts`, change the function signature (currently line 57):

```ts
export function crossSectionalBacktest(
  bars: Map<string, Candle[]>,
  cfg: CsConfig,
  isMember?: (symbol: string, day: number) => boolean,
): CsResult {
```

In the "5. Rank today's eligible set" loop (currently lines 211-213), add the guard immediately after the existing `open.has` check and before scoring:

```ts
      for (const symbol of tradable) {
        if (open.has(symbol)) continue;
        if (isMember && !isMember(symbol, day)) continue;
        const s = seriesBySymbol.get(symbol)!;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossSectional/engine.test.ts`
Expected: PASS — every test in the file, including the 3 new ones and every pre-existing test, passes unchanged.

- [ ] **Step 5: Mutation check**

Temporarily comment out the guard line (`if (isMember && !isMember(symbol, day)) continue;`) in `engine.ts`, then run:

Run: `npx tsx --test src/lib/backtest/crossSectional/engine.test.ts`
Expected: exactly "isMember excludes a non-member symbol from candidate selection" FAILS (now finds 1 trade, not 0); every other test still passes.

Restore the guard line, then re-run to confirm all tests pass again.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossSectional/engine.ts src/lib/backtest/crossSectional/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(quant): gate cross-sectional candidate selection on point-in-time membership

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `buildSnapshots` membership gate (momentum engine)

**Files:**
- Modify: `src/lib/backtest/crossMomentum/study.ts`
- Test: `src/lib/backtest/crossMomentum/study.test.ts` (append; do not alter any existing test)

**Interfaces:**
- Consumes: nothing new imported, same inline type as Task 3.
- Produces: `buildSnapshots(bars: Map<string, Candle[]>, cfg: MomentumConfig, isMember?: (symbol: string, day: number) => boolean): StudyOutput` — third parameter is new.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/backtest/crossMomentum/study.test.ts` (it already defines `DAY`, `START`, `cfg`, `series`, `trend`, `twoSymbols` at the top — reuse them):

```ts
test("isMember excludes a non-member symbol from a rebalance", () => {
  const bars = twoSymbols();
  const { snapshots: baseline } = buildSnapshots(bars, cfg);
  const firstDay = baseline[0].day;

  // DOWN is a member only from the day AFTER the first rebalance's ranking
  // day, so it must be excluded from that specific snapshot.
  const isMember = (symbol: string, d: number) => symbol === "UP" || d > firstDay;
  const { snapshots } = buildSnapshots(bars, cfg, isMember);
  assert.ok(!snapshots[0].symbols.includes("DOWN"), "DOWN should be excluded from the first rebalance");
  assert.ok(snapshots[0].symbols.includes("UP"), "UP should still be included");
});

test("isMember includes a symbol once it becomes a member", () => {
  const bars = twoSymbols();
  const { snapshots: baseline } = buildSnapshots(bars, cfg);
  const firstDay = baseline[0].day;

  const isMember = (symbol: string, d: number) => symbol === "UP" || d > firstDay;
  const { snapshots } = buildSnapshots(bars, cfg, isMember);
  const second = snapshots[1];
  assert.ok(second.symbols.includes("DOWN"), "DOWN should be a candidate again once it becomes a member");
});

test("omitting isMember reproduces today's behaviour bit-for-bit", () => {
  const bars = twoSymbols();
  const withUndefined = buildSnapshots(bars, cfg, undefined);
  const withoutParam = buildSnapshots(bars, cfg);
  assert.deepEqual(withUndefined, withoutParam);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossMomentum/study.test.ts`
Expected: FAIL — `buildSnapshots` does not accept a third argument yet.

- [ ] **Step 3: Add the parameter and the guard**

In `src/lib/backtest/crossMomentum/study.ts`, change the function signature (currently line 35):

```ts
export function buildSnapshots(
  bars: Map<string, Candle[]>,
  cfg: MomentumConfig,
  isMember?: (symbol: string, day: number) => boolean,
): StudyOutput {
```

In the per-rebalance loop (currently lines 55-58), add the guard immediately after resolving `i`, before scoring:

```ts
    for (const [symbol, candles] of bars) {
      const perDay = index.get(symbol)!;
      const i = perDay.get(days[rankIdx]);
      if (i === undefined) continue;
      if (isMember && !isMember(symbol, days[rankIdx])) continue;

      // Selection happens here, on data no later than the ranking day.
      const score = momentumScores(candles, i, cfg.lookback, cfg.skip);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/study.test.ts`
Expected: PASS — all new and pre-existing tests in the file pass.

- [ ] **Step 5: Mutation check**

Temporarily comment out the guard line in `study.ts`, then run:

Run: `npx tsx --test src/lib/backtest/crossMomentum/study.test.ts`
Expected: exactly "isMember excludes a non-member symbol from a rebalance" FAILS; every other test still passes.

Restore the guard line, then re-run to confirm all tests pass again.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossMomentum/study.ts src/lib/backtest/crossMomentum/study.test.ts
git commit -m "$(cat <<'EOF'
feat(quant): gate momentum rebalance selection on point-in-time membership

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Mean-reversion re-run

**Files:**
- Modify: `scripts/sweep-cross-sectional.mts`
- Modify: `scripts/walkforward-cross-sectional.mts`
- Create: `docs/quant/2026-08-18-cross-sectional-mean-reversion-pointintime-rerun.md`

**Interfaces:**
- Consumes: `parseMembershipCsv`, `buildMembershipIndex` (Task 1), `.cache/sp500-membership.csv` (Task 2), the `isMember`-aware `crossSectionalBacktest` (Task 3).

Both scripts gain a new trailing, optional CLI flag (`pit`, default `"n"`) rather than gating automatically, so every existing invocation of these general-purpose sweep tools keeps behaving exactly as it does today unless the flag is explicitly passed.

- [ ] **Step 1: Wire the flag into `sweep-cross-sectional.mts`**

Add the import (alongside the existing imports at the top of the file):

```ts
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";
```

Change the CLI-arg line (currently line 13) and add the membership index right after the bars are loaded (currently lines 13-20):

```ts
const universeKey = process.argv[2] ?? "sp500";
const pit = process.argv[3] === "y";
const TRAIN_FRACTION = 0.65;

const raw = JSON.parse(await readFile(`.cache/bars/${universeKey}-1d.json`, "utf8")) as {
  fetchedAt: string;
  bars: Record<string, Candle[]>;
};
console.log(`loaded ${Object.keys(raw.bars).length} symbols from cache (fetched ${raw.fetchedAt})`);

const isMember = pit
  ? buildMembershipIndex(parseMembershipCsv(await readFile(".cache/sp500-membership.csv", "utf8")))
  : undefined;
if (pit) console.log("point-in-time membership gate: ON (.cache/sp500-membership.csv)");
```

Change the one call to `crossSectionalBacktest` inside `runWindow` (currently line 60):

```ts
function runWindow(bars: Map<string, Candle[]>, cfg: CsConfig, windowStart: number): CsSummary {
  const res = crossSectionalBacktest(bars, cfg, isMember);
```

`runWindow` closes over the top-level `isMember` const, so every caller of `runWindow` — including the "no combo passed" diagnostic at the bottom of the file — picks up the gate automatically with no further edits.

Update the usage comment at the top of the file (currently line 5):

```ts
// Usage: node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts [universe] [pit:y|n]
```

- [ ] **Step 2: Wire the flag into `walkforward-cross-sectional.mts`**

Add the import:

```ts
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";
```

Change the CLI-arg destructuring (currently lines 16-17) and add the membership index right after `bars` is loaded (currently line 41):

```ts
const [, , universeKey = "sp500", measure = "atrReturn", lookback = "3", regime = "spySma200",
  slots = "5", holdDays = "5", stop = "off", sma200 = "y", pitArg = "n"] = process.argv;
const pit = pitArg === "y";
```

```ts
const bars = await loadBars(universeKey);
console.log(`config: ${JSON.stringify({ ...cfg, costs: undefined })}\n`);

const isMember = pit
  ? buildMembershipIndex(parseMembershipCsv(await readFile(".cache/sp500-membership.csv", "utf8")))
  : undefined;
if (pit) console.log("point-in-time membership gate: ON (.cache/sp500-membership.csv)\n");
```

Change the `crossSectionalBacktest` call inside `runWindow` (currently line 66):

```ts
function runWindow(all: Map<string, Candle[]>, from: number, to: number): CsSummary {
  const res = crossSectionalBacktest(windowBars(all, from, to), cfg, isMember);
```

Change the stress-gate call (currently lines 110-113):

```ts
const stressed = crossSectionalBacktest(bars, {
  ...cfg,
  costs: { slippageBps: (DEFAULT_COST_MODEL.slippageBps ?? 0) * 3, commissionBps: (DEFAULT_COST_MODEL.commissionBps ?? 0) * 3 },
}, isMember).summary;
```

Change the universe-haircut loop (currently lines 118-126). `dow30` and `nasdaq100` stay ungated — they have no point-in-time table (Dow 30 is explicitly out of scope; nasdaq100 was never in scope for this fix either) and the whole point of the haircut gate is comparing against universes that are, if anything, *more* survivorship-contaminated:

```ts
for (const key of ["dow30", "nasdaq100", "sp500"]) {
  try {
    const s = crossSectionalBacktest(await loadBars(key), cfg, pit && key === "sp500" ? isMember : undefined).summary;
    haircut[key] = s.profitFactor ?? 0;
    console.log(`${key.padEnd(12)} PF=${(s.profitFactor ?? 0).toFixed(2)} trades=${s.trades}`);
  } catch {
    console.log(`${key.padEnd(12)} (no cache — run cache-daily-bars.mts for this universe)`);
  }
}
```

Change the gate-7 full-run call (currently line 136):

```ts
const full = crossSectionalBacktest(bars, cfg, isMember).summary;
```

Update the usage comment at the top of the file (currently lines 5-6):

```ts
// Usage: node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts \
//          [universe] [measure] [lookback] [regime] [slots] [holdDays] [stop|off] [sma200:y|n] [pit:y|n]
```

- [ ] **Step 3: Smoke-check the flag reproduces old behaviour when off, and changes when on**

Run: `node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y n`
Expected: identical gate scorecard to a pre-Task-5 run of the same command (no `pit` arg) — the trailing `n` is a no-op.

Run: `node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y y`
Expected: prints `point-in-time membership gate: ON`, and at least one gate value (e.g. gate 1's trade counts) differs from the `n` run — the gate now excludes some previously-eligible candidate-days.

- [ ] **Step 4: Run the re-run for the results doc**

```bash
node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500 y
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y y
```

These use the exact "best" config identified in the original 2026-08-15 run (`measure=atrReturn lookback=3 regime=off slots=10 holdDays=5 stop=off sma200=y`) — nothing about the config changes, only the membership gate. Capture the full console output of both commands; it is the source material for Step 5.

- [ ] **Step 5: Hand-assemble the results doc**

Write `docs/quant/2026-08-18-cross-sectional-mean-reversion-pointintime-rerun.md`, following the structure of `docs/quant/2026-08-15-cross-sectional-mean-reversion-results.md` (TL;DR, How this was measured, sweep table, gate scorecard, verdict, reproducing-these-numbers), populated with the real output from Step 4. Include, near the top, a section stating plainly:

```markdown
## What changed from the 2026-08-15 run

Nothing except the universe. Every gate, threshold, config value, train/test split
fraction, and cost model is identical to the original run — this is a data-correctness
re-run, not a re-cut of the hypothesis. The only difference: candidate selection is now
gated on real point-in-time S&P 500 membership (`src/lib/backtest/crossSectional/membership.ts`),
instead of applying today's S&P 500 list uniformly across the entire backtest history.

This fixes look-ahead inclusion (a symbol traded as a candidate before it actually joined
the index) and stale inclusion (a symbol kept trading as a candidate after it actually left).
It does **not** fix omission bias for names that left the S&P 500 before
`.cache/bars/sp500-1d.json` was ever built — those tickers have no cached price history and
cannot appear as candidates regardless of what the membership table says. Every number below
remains an upper bound for that reason.
```

The verdict section states the real outcome from the gate scorecard produced in Step 4 (REJECTED unless the gates actually flip — do not pre-judge the number, report what the script printed).

- [ ] **Step 6: Commit**

```bash
git add scripts/sweep-cross-sectional.mts scripts/walkforward-cross-sectional.mts docs/quant/2026-08-18-cross-sectional-mean-reversion-pointintime-rerun.md
git commit -m "$(cat <<'EOF'
feat(quant): re-run cross-sectional mean reversion on point-in-time S&P 500 membership

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Momentum re-run

**Files:**
- Create: `scripts/decile-momentum-study-pointintime-rerun.mts` (copy of `scripts/decile-momentum-study.mts` with the membership gate wired in and the doc/date/framing updated — the original script is never modified, matching its own "don't clobber a written verdict" convention)
- Create: `docs/quant/2026-08-18-cross-sectional-momentum-pointintime-rerun.md` (written by the script above)

**Interfaces:**
- Consumes: `parseMembershipCsv`, `buildMembershipIndex` (Task 1), `.cache/sp500-membership.csv` (Task 2), the `isMember`-aware `buildSnapshots` (Task 4). All other imports (`evaluateGates`, `subsetBars`, `topByDollarVolume`, `screenBars`, `alignUniverse`) are unchanged from the original script.

Unlike the mean-reversion scripts (Task 5), this is a single-purpose re-run script, not a general-purpose tool other future runs will reuse unmodified — so the membership gate here is always on, no CLI flag.

- [ ] **Step 1: Write the new script**

```ts
// scripts/decile-momentum-study-pointintime-rerun.mts
// Point-in-time re-run of scripts/decile-momentum-study.mts: identical
// config, gates, and universe cache — the only change is that buildSnapshots
// is gated on real point-in-time S&P 500 membership instead of today's
// static list. The original script and its results doc
// (docs/quant/2026-08-16-cross-sectional-momentum-results.md) are left
// untouched, matching that script's own warning against overwriting a
// written verdict.
//
// Usage: npx tsx scripts/decile-momentum-study-pointintime-rerun.mts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { alignUniverse } from "@/lib/backtest/crossSectional/calendar";
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";
import { evaluateGates } from "@/lib/backtest/crossMomentum/gates";
import { buildSnapshots, subsetBars, topByDollarVolume } from "@/lib/backtest/crossMomentum/study";
import {
  screenBars,
  MIN_DAILY_RATIO,
  MAX_DAILY_RATIO,
  MAX_ZERO_VOLUME_SHARE,
  MAX_MEDIAN_SPACING_DAYS,
} from "@/lib/backtest/crossMomentum/dataQuality";
import type { MomentumConfig, ScoreLeg } from "@/lib/backtest/crossMomentum/types";
import type { Candle } from "@/lib/indicators";

const CACHE = ".cache/bars/sp500-1d.json";
const MEMBERSHIP_CACHE = ".cache/sp500-membership.csv";
const OUT = "docs/quant/2026-08-18-cross-sectional-momentum-pointintime-rerun.md";
const MEGA_CAP_COUNT = 200;
const DOLLAR_VOL_WINDOW = 63;
/** Set by hand, not read from the clock, so a re-run of the same cache is reproducible. */
const RUN_DATE = "2026-08-18";

// Identical to the original study's config — same lookback, skip, buckets,
// seed, iterations, blocks. Only the universe changes.
const cfg: MomentumConfig = {
  lookback: 252,
  skip: 21,
  buckets: 10,
  minEligible: 100,
  costBps: 5,
  seed: 20_260_816,
  iterations: 1_000,
  blocks: 6,
};

const raw = JSON.parse(await readFile(CACHE, "utf8")) as { fetchedAt: string; bars: Record<string, Candle[]> };
const cached = new Map(Object.entries(raw.bars));
// SPY is an index proxy, not a cross-section member.
cached.delete("SPY");

const isMember = buildMembershipIndex(parseMembershipCsv(await readFile(MEMBERSHIP_CACHE, "utf8")));

// Screen before anything is measured — same screen as the original study.
const { kept: bars, excluded } = screenBars(cached);
if (bars.size === 0) throw new Error("data screen rejected every symbol — check the cache");

const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const full = buildSnapshots(bars, cfg, isMember);
if (full.snapshots.length === 0) throw new Error("no rebalance dates produced — check the cache");

const { days, index } = alignUniverse(bars);
const lateStarts = [...index.values()].filter((m) => ![...m.keys()].includes(days[0])).length;
const earlyEnds = [...index.values()].filter((m) => ![...m.keys()].includes(days[days.length - 1])).length;
const megaSymbols = topByDollarVolume(bars, days, full.snapshots[0].day, DOLLAR_VOL_WINDOW, MEGA_CAP_COUNT);
const mega = buildSnapshots(subsetBars(bars, megaSymbols), cfg, isMember);

const legs: ScoreLeg[] = ["raw", "volAdj"];
const reports = legs.map((leg) =>
  evaluateGates({ leg, snapshots: full.snapshots, megaCapSnapshots: mega.snapshots, cfg }),
);

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
const yn = (b: boolean) => (b ? "**PASS**" : "**FAIL**");

const lines: string[] = [
  "# Cross-Sectional Momentum — Point-in-Time Membership Re-run",
  "",
  `**Run date:** ${RUN_DATE} · **Cache fetched:** ${raw.fetchedAt}`,
  `**Spec:** \`docs/superpowers/specs/2026-08-18-point-in-time-membership-design.md\``,
  "",
  "This is a diagnostic, not a strategy. The strongest outcome available is NOT REJECTED.",
  "",
  "> Everything above the `## Verdict` heading below is machine-generated by",
  "> `scripts/decile-momentum-study-pointintime-rerun.mts`. Re-running that script overwrites this",
  "> entire file with `writeFile`, including the `## Verdict` section — the script has no knowledge",
  "> that section exists. Do not re-run it after the verdict has been written; if the study needs to",
  "> be re-run, copy the verdict out first and reconcile it by hand afterward.",
  "",
  "## What changed from the 2026-08-16 run",
  "",
  "Nothing except the universe. The config (lookback, skip, buckets, seed, iterations, blocks), the",
  "six pre-registered gates and their thresholds, and the underlying price cache are all identical to",
  "`docs/quant/2026-08-16-cross-sectional-momentum-results.md`. The only difference: candidate",
  "selection in `buildSnapshots` is now gated on real point-in-time S&P 500 membership",
  "(`src/lib/backtest/crossSectional/membership.ts`) instead of applying today's S&P 500 list",
  "uniformly across the whole backtest history. This is a data-correctness re-run, not a re-cut of",
  "the hypothesis, using the same reasoning the original study used when it redid its first pass",
  "after finding unadjusted-split contamination in the cache — the original file and its written",
  "verdict are untouched.",
  "",
  "This fixes look-ahead inclusion (a symbol ranked as a candidate before it actually joined the",
  "index) and stale inclusion (a symbol kept ranking as a candidate after it actually left). It does",
  "**not** fix omission bias for names that left the S&P 500 before `.cache/bars/sp500-1d.json` was",
  "ever built — those tickers have no cached price history and cannot appear as candidates regardless",
  "of what the membership table says. Every number below remains an upper bound for that reason.",
  "",
  "## Data screen (stated before the results)",
  "",
  "Alpaca's `adjustment=all` is incomplete for recent splits, so the cache is screened rather than",
  "trusted — same screen as the original study. A symbol is excluded from the study entirely — not",
  "for one month — when any of these holds:",
  "",
  `1. its bars are spaced more than ${MAX_MEDIAN_SPACING_DAYS} calendar days apart at the median — i.e. it is not a daily series;`,
  `2. any close is zero or negative;`,
  `3. any adjacent-session close ratio falls outside [${MIN_DAILY_RATIO}, ${MAX_DAILY_RATIO}];`,
  `4. at least ${(MAX_ZERO_VOLUME_SHARE * 100).toFixed(0)}% of its bars have zero volume (a placeholder or reused-ticker series).`,
  "",
  `**${excluded.length} of ${cached.size} symbols excluded.**`,
  "",
  ...(excluded.length === 0
    ? ["_(none)_", ""]
    : [
        "| Symbol | Reason | Evidence |",
        "|---|---|---|",
        ...excluded.map((e) => `| ${e.symbol} | ${e.reason} | ${e.detail} |`),
        "",
      ]),
  "## Sample",
  "",
  `- symbols: ${bars.size}`,
  `- rebalances: **${full.snapshots.length}** (${iso(full.snapshots[0].day)} → ${iso(full.snapshots[full.snapshots.length - 1].day)})`,
  `- eligible per rebalance: min ${Math.min(...full.snapshots.map((s) => s.symbols.length))}, max ${Math.max(...full.snapshots.map((s) => s.symbols.length))}`,
  `- fill/exit substitutions: ${full.substitutions} (${pct(full.substitutions / full.snapshots.reduce((n, s) => n + s.symbols.length, 0))} of symbol-months)`,
  `- unfillable selections (dropped, no measurable return): ${full.unfillable}`,
  `- mega-cap subset: ${megaSymbols.size} symbols, ${mega.snapshots.length} rebalances`,
  `- config: lookback ${cfg.lookback}, skip ${cfg.skip}, buckets ${cfg.buckets}, seed ${cfg.seed}, ${cfg.iterations} permutations`,
  "",
];

for (const r of reports) {
  lines.push(
    `## Leg ${r.leg === "raw" ? "A — classic 12-1" : "B — volatility-adjusted"}`,
    "",
    `### Verdict: ${r.passed ? "**NOT REJECTED**" : "**REJECTED**"}`,
    "",
    "| # | Gate | Value | Threshold | Result |",
    "|---|---|---|---|---|",
    `| 1 | Monotonicity (Spearman ρ) | ${r.monotonicity.rho.toFixed(3)} | ≥ 0.60 | ${yn(r.monotonicity.pass)} |`,
    `| 2 | Permutation p | ${r.permutation.p.toFixed(4)} | ≤ 0.05 | ${yn(r.permutation.pass)} |`,
    `| 3 | Other leg's mean spread | ${pct(r.crossDefinition.otherMeanSpread)} | > 0 | ${yn(r.crossDefinition.pass)} |`,
    `| 4 | Bottom bucket vs universe ex-top | ${pct(r.notTopOnly.meanShortLegExcess)} | > 0 | ${yn(r.notTopOnly.pass)} |`,
    `| 5 | Mega-cap mean spread | ${pct(r.megaCap.meanSpread)} | > 0 | ${yn(r.megaCap.pass)} |`,
    `| 6 | Positive sub-periods | ${r.subPeriods.positive} of ${r.subPeriods.of} | ≥ 4 | ${yn(r.subPeriods.pass)} |`,
    "",
    "Reported, not gated:",
    "",
    `- mean monthly spread: **${pct(r.meanSpread)}** (net of 5 bps/side: ${pct(r.netMeanSpread)})`,
    `- t-statistic: **${r.tStat.toFixed(2)}** over ${r.months} months`,
    `- mean turnover per rebalance: ${pct(r.meanTurnover)}`,
    `- bucket means (1 = losers → ${cfg.buckets} = winners): ${r.bucketMeans.map((x) => pct(x)).join(", ")}`,
    `- sub-period means: ${r.subPeriods.blockMeans.map((x) => pct(x)).join(", ")}`,
    "",
  );
  console.log(`${r.leg}: ${r.passed ? "NOT REJECTED" : "REJECTED"}  rho=${r.monotonicity.rho.toFixed(3)} p=${r.permutation.p.toFixed(4)} spread=${pct(r.meanSpread)} t=${r.tStat.toFixed(2)}`);
}

lines.push(
  "## Reading these numbers",
  "",
  `At ${full.snapshots.length} monthly observations, \`t = 2\` requires an annual Sharpe near 0.90, while`,
  "published momentum decile spreads run 0.5-0.6 over far longer samples. The t-statistic above is",
  "therefore reported for reference and is not one of the gates.",
  "",
  "The universe is now point-in-time S&P 500 membership rather than today's list backfilled, which",
  "removes look-ahead inclusion and stale inclusion. It is still survivorship-biased toward names that",
  "have cached price history in the first place — see \"What changed\" above.",
  "",
  `The union calendar holds ${days.length} trading days. Of the ${bars.size} surviving symbols, ${lateStarts} have no bar on the`,
  `first day and ${earlyEnds} have none on the last. The fill/exit logic in buildSnapshots covers those,`,
  "and the unfillable count above is the number of selections that could not be measured at all.",
  "",
);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, lines.join("\n"));
console.log(`\nwrote ${OUT}`);
```

- [ ] **Step 2: Run it**

```bash
npx tsx scripts/decile-momentum-study-pointintime-rerun.mts
```

Expected: prints per-leg verdict lines (`raw: ... rho=... p=... spread=... t=...` and `volAdj: ...`), then `wrote docs/quant/2026-08-18-cross-sectional-momentum-pointintime-rerun.md`. Confirm the generated file exists and its `## Sample` section's date range and rebalance count differ from the original 2026-08-16 doc's (evidence the membership gate actually changed the eligible universe, not just cosmetics).

- [ ] **Step 3: Hand-append the Verdict section**

Read the generated doc, then append a `## Verdict` section stating the real outcome from Step 2's console output for both legs (do not pre-judge — report REJECTED or NOT REJECTED per leg exactly as the gates decided), following the same tone as the original doc's verdict section. If either leg flips to NOT REJECTED, state plainly that this opens a separate future question (tradability under $2-3k whole-share sizing) that is out of scope here, per the spec.

- [ ] **Step 4: Confirm the original script and doc are untouched**

Run: `git status scripts/decile-momentum-study.mts docs/quant/2026-08-16-cross-sectional-momentum-results.md`
Expected: no changes reported for either path.

- [ ] **Step 5: Commit**

```bash
git add scripts/decile-momentum-study-pointintime-rerun.mts docs/quant/2026-08-18-cross-sectional-momentum-pointintime-rerun.md
git commit -m "$(cat <<'EOF'
feat(quant): re-run cross-sectional momentum on point-in-time S&P 500 membership

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
