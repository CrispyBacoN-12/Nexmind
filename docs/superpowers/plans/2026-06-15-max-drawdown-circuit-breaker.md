# Max Drawdown Circuit Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically trip the existing kill switch (with a recorded reason) when realized account equity drops more than a configurable percentage below its all-time peak, and surface this in the Safety panel.

**Architecture:** A new pure module `circuitBreaker.ts` computes the current drawdown percentage from closed-trade P/L (same methodology as `computeStats`). `manageOpenTrades()` (runs every 5 min) calls it and, if the kill switch is currently off and drawdown exceeds the configurable threshold, sets `killSwitch=true` and a `killSwitchReason` message. The Safety panel exposes the threshold setting, the live current-drawdown stat, and the trip reason.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` (via `npm test` = `tsx --test "src/**/*.test.ts"`), Prisma 7 / SQLite, Next.js 16 App Router, React.

---

## File Structure

- Create: `src/lib/trading/circuitBreaker.ts` — pure `currentDrawdownPct()` function
- Create: `src/lib/trading/circuitBreaker.test.ts` — unit tests for the above
- Modify: `src/lib/settings.ts` — add `getDrawdownHaltPct()` and `getKillSwitchReason()`
- Modify: `src/lib/trading/manage.ts` — wire the breaker check into `manageOpenTrades()`
- Modify: `src/app/api/settings/route.ts` — expose/update the new settings and live drawdown stat
- Modify: `src/app/command/safety-panel.tsx` — UI: threshold input, current-drawdown stat, trip-reason banner

---

### Task 1: `circuitBreaker.ts` — pure drawdown calculation

**Files:**
- Create: `src/lib/trading/circuitBreaker.ts`
- Test: `src/lib/trading/circuitBreaker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/trading/circuitBreaker.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentDrawdownPct } from "./circuitBreaker";
import type { ClosedTrade } from "./stats";

function trade(pnl: number, day: string): ClosedTrade {
  return { pnl, rMultiple: null, outcome: null, closedAt: new Date(day) };
}

test("currentDrawdownPct: empty input returns 0", () => {
  assert.equal(currentDrawdownPct([], 10000), 0);
});

test("currentDrawdownPct: peak <= 0 returns 0 (division-by-zero guard)", () => {
  assert.equal(currentDrawdownPct([], -100), 0);
  assert.equal(currentDrawdownPct([], 0), 0);
});

test("currentDrawdownPct: equity strictly increasing returns 0", () => {
  const closed = [trade(10, "2026-06-01"), trade(20, "2026-06-02"), trade(30, "2026-06-03")];
  assert.equal(currentDrawdownPct(closed, 1000), 0);
});

test("currentDrawdownPct: simple drawdown from a single peak", () => {
  // 1000 -> +100 -> 1100 (peak) -> -50 -> 1050. dd = (1100-1050)/1100*100
  const closed = [trade(100, "2026-06-01"), trade(-50, "2026-06-02")];
  const expected = (50 / 1100) * 100;
  assert.ok(Math.abs(currentDrawdownPct(closed, 1000) - expected) < 1e-9);
});

test("currentDrawdownPct: recovery after a drawdown does not reset the peak", () => {
  // 1000 -> +200 -> 1200 (peak) -> -150 -> 1050 -> +50 -> 1100. dd = (1200-1100)/1200*100
  const closed = [trade(200, "2026-06-01"), trade(-150, "2026-06-02"), trade(50, "2026-06-03")];
  const expected = (100 / 1200) * 100;
  assert.ok(Math.abs(currentDrawdownPct(closed, 1000) - expected) < 1e-9);
});

test("currentDrawdownPct: multiple peaks/troughs reflects current gap, not the largest historical drawdown", () => {
  // 1000 -> +100 -> 1100 (peak) -> -80 -> 1020 (dd here would be ~7.27%, but not returned)
  //      -> +200 -> 1220 (new peak) -> -30 -> 1190. dd = (1220-1190)/1220*100 (~2.46%)
  const closed = [trade(100, "2026-06-01"), trade(-80, "2026-06-02"), trade(200, "2026-06-03"), trade(-30, "2026-06-04")];
  const expected = (30 / 1220) * 100;
  const result = currentDrawdownPct(closed, 1000);
  assert.ok(Math.abs(result - expected) < 1e-9);
  assert.ok(result < (80 / 1100) * 100, "current gap should be smaller than the earlier, larger drawdown");
});

test("currentDrawdownPct: trades with identical closedAt are processed in stable input order", () => {
  // Both have the same timestamp, so the sort comparator returns 0 and the
  // original array order is preserved (Array.prototype.sort is stable).
  // Order here: -50 first (1000 -> 950, peak stays 1000), then +100 (950 -> 1050, peak -> 1050).
  // dd = (1050-1050)/1050*100 = 0
  const closed = [trade(-50, "2026-06-01"), trade(100, "2026-06-01")];
  assert.equal(currentDrawdownPct(closed, 1000), 0);
});

test("currentDrawdownPct: does not mutate the input array", () => {
  const closed = [trade(-50, "2026-06-02"), trade(100, "2026-06-01")];
  const before = closed.map((t) => ({ ...t }));
  currentDrawdownPct(closed, 1000);
  assert.deepEqual(closed, before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsx --test "src/lib/trading/circuitBreaker.test.ts"`
Expected: FAIL — `Cannot find module './circuitBreaker'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/trading/circuitBreaker.ts
import type { ClosedTrade } from "./stats";

/**
 * Current drawdown as a percentage below the all-time equity peak.
 * 0 means equity is at or above its peak. Walks closed trades in
 * chronological order over startingBalance + cumulative pnl.
 */
export function currentDrawdownPct(closed: ClosedTrade[], startingBalance: number): number {
  const ordered = [...closed].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));
  let equity = startingBalance;
  let peak = startingBalance;
  for (const t of ordered) {
    equity += t.pnl ?? 0;
    peak = Math.max(peak, equity);
  }
  return peak <= 0 ? 0 : Math.max(0, ((peak - equity) / peak) * 100);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsx --test "src/lib/trading/circuitBreaker.test.ts"`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/circuitBreaker.ts src/lib/trading/circuitBreaker.test.ts
git commit -m "feat: add currentDrawdownPct circuit breaker calculation"
```

---

### Task 2: `settings.ts` — drawdown threshold and kill-switch reason getters

**Files:**
- Modify: `src/lib/settings.ts:30-35` (immediately after `getRiskPctPerTrade`)

- [ ] **Step 1: Add the two new getters**

In `src/lib/settings.ts`, after the existing `getRiskPctPerTrade` function (and before the `FearGreed` interface), add:

```ts
export async function getDrawdownHaltPct(): Promise<number> {
  const n = parseFloat(await getSetting("drawdownHaltPct", "10"));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function getKillSwitchReason(): Promise<string> {
  return getSetting("killSwitchReason", "");
}
```

No schema change — both use the existing `Setting` key/value table (same pattern as `riskPctPerTrade`, `maxOpenPositions`). Default `drawdownHaltPct` is `"10"` (10%); default `killSwitchReason` is `""`.

- [ ] **Step 2: Type-check**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat: add getDrawdownHaltPct and getKillSwitchReason settings"
```

---

### Task 3: Wire the breaker into `manageOpenTrades()`

**Files:**
- Modify: `src/lib/trading/manage.ts`

- [ ] **Step 1: Add imports**

At the top of `src/lib/trading/manage.ts`, add to the existing imports (after the `decideAction`/`LadderState` import on line 10):

```ts
import { currentDrawdownPct } from "./circuitBreaker";
import { isKillSwitchOn, getStartingBalance, getDrawdownHaltPct, setSetting } from "@/lib/settings";
```

- [ ] **Step 2: Add the circuit breaker check before the final return**

In `manageOpenTrades()`, replace:

```ts
  return { checked: open.length, closed, partials };
}
```

with:

```ts
  const killSwitchOn = await isKillSwitchOn();
  if (!killSwitchOn) {
    const [allClosed, startingBalance, haltPct] = await Promise.all([
      prisma.trade.findMany({
        where: { status: "closed" },
        orderBy: { closedAt: "asc" },
        select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
      }),
      getStartingBalance(),
      getDrawdownHaltPct(),
    ]);
    const dd = currentDrawdownPct(allClosed, startingBalance);
    if (dd >= haltPct) {
      await setSetting("killSwitch", "true");
      await setSetting(
        "killSwitchReason",
        `Auto-halted: drawdown -${dd.toFixed(1)}% exceeded ${haltPct}% limit at ${new Date().toISOString()}`,
      );
    }
  }

  return { checked: open.length, closed, partials };
}
```

This only runs when the kill switch is currently off, so once tripped (manually or automatically) the check is skipped until the user turns it back off — satisfying "halt persists until manual reset" with no extra state. `ManageSummary`'s shape is unchanged; this is a side effect, like `recordLesson`.

- [ ] **Step 3: Type-check and run the full test suite**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsc --noEmit && npm test`
Expected: no type errors; all existing tests still pass (this change adds no new tests for `manage.ts`, matching its existing untested-I/O convention — see Task 1's `circuitBreaker.test.ts` for the covered logic).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trading/manage.ts
git commit -m "feat: auto-trip kill switch on max drawdown in manageOpenTrades"
```

---

### Task 4: Expose drawdown settings and live stat via `/api/settings`

**Files:**
- Modify: `src/app/api/settings/route.ts`

- [ ] **Step 1: Update imports**

Replace the import line:

```ts
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";
```

with:

```ts
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions, getStartingBalance, getRiskPctPerTrade, getDrawdownHaltPct, getKillSwitchReason } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { currentDrawdownPct } from "@/lib/trading/circuitBreaker";
```

- [ ] **Step 2: Update `snapshot()` to include the new fields**

Replace the `snapshot` function:

```ts
async function snapshot() {
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    maxOpenPositions: await getMaxOpenPositions(),
    startingBalance: await getStartingBalance(),
    riskPctPerTrade: await getRiskPctPerTrade(),
    fearGreed: await getFearGreed(),
  });
}
```

with:

```ts
async function snapshot() {
  const [closed, startingBalance] = await Promise.all([
    prisma.trade.findMany({
      where: { status: "closed" },
      orderBy: { closedAt: "asc" },
      select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
    }),
    getStartingBalance(),
  ]);
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    killSwitchReason: await getKillSwitchReason(),
    maxOpenPositions: await getMaxOpenPositions(),
    startingBalance,
    riskPctPerTrade: await getRiskPctPerTrade(),
    drawdownHaltPct: await getDrawdownHaltPct(),
    currentDrawdownPct: currentDrawdownPct(closed, startingBalance),
    fearGreed: await getFearGreed(),
  });
}
```

- [ ] **Step 3: Update `POST` to accept `drawdownHaltPct` and clear the reason on manual reset**

Replace the `POST` function body:

```ts
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean;
    maxOpenPositions?: number;
    startingBalance?: number;
    riskPctPerTrade?: number;
  };
  if (typeof body.killSwitch === "boolean") await setSetting("killSwitch", String(body.killSwitch));
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  if (typeof body.startingBalance === "number" && body.startingBalance > 0) {
    await setSetting("startingBalance", String(body.startingBalance));
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0) {
    await setSetting("riskPctPerTrade", String(body.riskPctPerTrade));
  }
  return snapshot();
}
```

with:

```ts
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean;
    maxOpenPositions?: number;
    startingBalance?: number;
    riskPctPerTrade?: number;
    drawdownHaltPct?: number;
  };
  if (typeof body.killSwitch === "boolean") {
    await setSetting("killSwitch", String(body.killSwitch));
    if (!body.killSwitch) await setSetting("killSwitchReason", "");
  }
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  if (typeof body.startingBalance === "number" && body.startingBalance > 0) {
    await setSetting("startingBalance", String(body.startingBalance));
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0) {
    await setSetting("riskPctPerTrade", String(body.riskPctPerTrade));
  }
  if (typeof body.drawdownHaltPct === "number" && body.drawdownHaltPct > 0) {
    await setSetting("drawdownHaltPct", String(body.drawdownHaltPct));
  }
  return snapshot();
}
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsc --noEmit && npm test`
Expected: no type errors; all existing tests still pass.

- [ ] **Step 5: Manual smoke check against the running dev server**

The dev server runs on port 3275. Run:

`curl -s http://localhost:3275/api/settings`

Expected: JSON response now includes `killSwitchReason`, `drawdownHaltPct` (10 by default), and `currentDrawdownPct` (a number >= 0) alongside the existing fields.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat: expose drawdownHaltPct, killSwitchReason, currentDrawdownPct via /api/settings"
```

---

### Task 5: Safety panel UI — threshold input, drawdown stat, trip-reason banner

**Files:**
- Modify: `src/app/command/safety-panel.tsx`

- [ ] **Step 1: Extend the `Settings` interface and `update` patch type**

Replace:

```ts
interface Settings {
  killSwitch: boolean;
  maxOpenPositions: number;
  startingBalance: number;
  riskPctPerTrade: number;
  fearGreed: { value: number; label: string } | null;
}
```

with:

```ts
interface Settings {
  killSwitch: boolean;
  killSwitchReason: string;
  maxOpenPositions: number;
  startingBalance: number;
  riskPctPerTrade: number;
  drawdownHaltPct: number;
  currentDrawdownPct: number;
  fearGreed: { value: number; label: string } | null;
}
```

Replace:

```ts
  async function update(patch: { killSwitch?: boolean; maxOpenPositions?: number; startingBalance?: number; riskPctPerTrade?: number }) {
```

with:

```ts
  async function update(patch: { killSwitch?: boolean; maxOpenPositions?: number; startingBalance?: number; riskPctPerTrade?: number; drawdownHaltPct?: number }) {
```

- [ ] **Step 2: Add the trip-reason banner around the kill switch row**

Replace:

```tsx
      <div className="flex items-center justify-between gap-3 mt-2">
        <div>
          <div className={`text-sm font-medium ${s.killSwitch ? "text-red-400" : ""}`}>
            {s.killSwitch ? "TRADING HALTED" : "Trading enabled"}
          </div>
          <p className="text-xs text-(--color-muted)">
            Kill switch blocks all new trades. Open positions still close at SL/TP.
          </p>
        </div>
        <Button
          size="sm"
          variant={s.killSwitch ? "outline" : "danger"}
          disabled={busy}
          onClick={() => update({ killSwitch: !s.killSwitch })}
        >
          {s.killSwitch ? "Resume trading" : "EMERGENCY STOP"}
        </Button>
      </div>
```

with:

```tsx
      {s.killSwitch && s.killSwitchReason && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {s.killSwitchReason}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div>
          <div className={`text-sm font-medium ${s.killSwitch ? "text-red-400" : ""}`}>
            {s.killSwitch ? "TRADING HALTED" : "Trading enabled"}
          </div>
          <p className="text-xs text-(--color-muted)">
            Kill switch blocks all new trades. Open positions still close at SL/TP.
          </p>
        </div>
        <Button
          size="sm"
          variant={s.killSwitch ? "outline" : "danger"}
          disabled={busy}
          onClick={() => update({ killSwitch: !s.killSwitch })}
        >
          {s.killSwitch ? "Resume trading" : "EMERGENCY STOP"}
        </Button>
      </div>
```

The banner sits directly above the toggle row, so the toggle ("Resume trading") doubles as the reset control right next to the reason.

- [ ] **Step 3: Add the "Max drawdown halt (%)" input and the current-drawdown stat**

Replace the closing of the risk-per-trade input block:

```tsx
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={s.riskPctPerTrade}
          disabled={busy}
          onChange={(e) => update({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
    </Card>
  );
}
```

with:

```tsx
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={s.riskPctPerTrade}
          disabled={busy}
          onChange={(e) => update({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Max drawdown halt (%)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={s.drawdownHaltPct}
          disabled={busy}
          onChange={(e) => update({ drawdownHaltPct: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs text-(--color-muted)">Current drawdown</span>
        <span className="text-xs font-mono">
          {s.currentDrawdownPct === 0 ? "0.0%" : `-${s.currentDrawdownPct.toFixed(1)}%`}
        </span>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd "C:\Users\Kannithi\CLAUDE WEB\nexmind" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check in the browser**

The dev server runs on port 3275. Open `http://localhost:3275/command` (or wherever `SafetyPanel` is rendered) and confirm:
- "Max drawdown halt (%)" input shows `10` by default and is editable.
- "Current drawdown" shows `0.0%` (not `-0.0%`) when there's no drawdown.
- No banner is shown while `killSwitch` is off.
- (Optional) Toggle `killSwitch` on manually via the EMERGENCY STOP button — banner should NOT appear (no `killSwitchReason` set on manual stop), confirming the banner is reserved for auto-trips.

- [ ] **Step 6: Commit**

```bash
git add src/app/command/safety-panel.tsx
git commit -m "feat: add drawdown halt setting, current drawdown stat, and auto-trip banner to Safety panel"
```

---

## Spec Coverage Check

- Drawdown calculation (realized P/L, all-time peak, `peak <= 0` guard, no mutation, stable sort) → Task 1
- New settings `drawdownHaltPct` / `killSwitchReason` (no schema change) → Task 2
- Auto-trip wiring in `manageOpenTrades()`, only when kill switch is off, `orderBy: closedAt asc` → Task 3
- `/api/settings` GET exposes `drawdownHaltPct`, `killSwitchReason`, `currentDrawdownPct`; POST accepts `drawdownHaltPct` and clears reason on manual reset → Task 4
- Safety panel: threshold input, always-visible current-drawdown stat with `0.0%`/`-X.X%` formatting, banner adjacent to the reset (kill switch) toggle → Task 5
- Caching / `@@index` — explicitly out of scope per spec, not included in any task
