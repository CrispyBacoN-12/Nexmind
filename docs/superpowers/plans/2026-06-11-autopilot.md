# NEXMIND Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an orchestrator bot loop, kill switch + max-position Iron Rules, live news/Fear & Greed intel, and TP1 partial close with breakeven SL — all paper-mode.

**Architecture:** A standalone `scripts/bot.ts` schedules HTTP calls against the running Next.js app; all logic stays in the app. One new Prisma model (`Setting`, key-value). Position management gains a pure decision core (`positionRules.ts`) so the ladder logic is unit-testable. Spec: `docs/superpowers/specs/2026-06-11-autopilot-design.md`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + SQLite, node:test via `tsx --test`, Finnhub API, alternative.me FNG API.

**Conventions:** Tests live next to sources (`src/lib/**/*.test.ts`, glob in `npm test`). DB gotcha: after `prisma db push` the dev server caches the old Prisma client — restart `next dev`. `db:push` needs `-- --url "file:./dev.db"`.

---

### Task 1: `Setting` model + settings lib

**Files:**
- Modify: `prisma/schema.prisma` (append at end)
- Create: `src/lib/settings.ts`

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`:

```prisma
/// App-wide key-value settings (kill switch, limits, cached intel).
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Push schema + regenerate client**

Run: `npm run db:push -- --url "file:./dev.db"`
Expected: "Your database is now in sync", client regenerated. (If a dev server is running, restart it later — cached client.)

- [ ] **Step 3: Create the settings lib**

`src/lib/settings.ts`:

```ts
// Typed access to the Setting key-value table. Defaults apply when a key is absent,
// so the app behaves identically before any setting has ever been written.

import { prisma } from "@/lib/db";

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function isKillSwitchOn(): Promise<boolean> {
  return (await getSetting("killSwitch", "false")) === "true";
}

export async function getMaxOpenPositions(): Promise<number> {
  const n = parseInt(await getSetting("maxOpenPositions", "5"), 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export interface FearGreed { value: number; label: string; fetchedAt: string }

export async function getFearGreed(): Promise<FearGreed | null> {
  try {
    return JSON.parse(await getSetting("fearGreed", "null")) as FearGreed | null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add prisma/schema.prisma src/lib/settings.ts
git commit -m "feat: Setting key-value model + typed settings lib"
```

---

### Task 2: Iron Rules — kill switch + max open positions (TDD)

**Files:**
- Modify: `src/lib/trading/ironRules.ts` (AccountState + applyIronRules)
- Test: `src/lib/trading/ironRules.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/trading/ironRules.test.ts` (uses existing `goodLong` / `baseAcc` fixtures):

```ts
test("kill switch blocks all new trades", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, killSwitch: true });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /kill switch/.test(f)));
});

test("max open positions blocks when at the cap", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 5, maxOpenPositions: 5 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /max open positions/.test(f)));
});

test("below the position cap still passes", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 4, maxOpenPositions: 5 });
  assert.equal(v.passed, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the 2 blocking tests FAIL (`passed` is `true` — rules not implemented yet); third may pass trivially.

- [ ] **Step 3: Implement**

In `src/lib/trading/ironRules.ts`, extend `AccountState`:

```ts
  killSwitch?: boolean; // global halt — blocks every new trade
  openPositions?: number; // current open trade count
  maxOpenPositions?: number; // cap; enforced only when both counts provided
```

In `applyIronRules`, after the `const failures: string[] = [];` line add:

```ts
  if (acc.killSwitch) failures.push("kill switch engaged — trading halted");

  if (
    acc.maxOpenPositions != null &&
    acc.openPositions != null &&
    acc.openPositions >= acc.maxOpenPositions
  ) {
    failures.push(`max open positions reached (${acc.openPositions}/${acc.maxOpenPositions})`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → all PASS (existing 7 + new 3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/ironRules.ts src/lib/trading/ironRules.test.ts
git commit -m "feat: iron rules — kill switch + max open positions"
```

---

### Task 3: Engine wiring — account state from DB + Fear & Greed in digests

**Files:**
- Modify: `src/lib/trading/engine.ts:91` (account build) and `engine.ts:130-133` (`latestNewsDigest`)
- Modify: `src/lib/trading/analyze.ts` (its own `latestNewsDigest`)

- [ ] **Step 1: Import settings in engine.ts**

```ts
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed } from "@/lib/settings";
```

- [ ] **Step 2: Build AccountState from DB**

Replace `const account = { ...DEFAULT_ACCOUNT, dailyLossUsd: await todaysRealizedLoss() };` with:

```ts
  const account: AccountState = {
    ...DEFAULT_ACCOUNT,
    dailyLossUsd: await todaysRealizedLoss(),
    killSwitch: await isKillSwitchOn(),
    openPositions: await prisma.trade.count({ where: { status: "open" } }),
    maxOpenPositions: await getMaxOpenPositions(),
  };
```

- [ ] **Step 3: Prepend Fear & Greed to the digest**

Replace `latestNewsDigest` in `engine.ts`:

```ts
async function latestNewsDigest(): Promise<string> {
  const fg = await getFearGreed();
  const news = await prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  const lines = news.map((n) => `${n.source}: ${n.title}${n.sentiment ? ` (${n.sentiment})` : ""}`).join("; ");
  return fg ? `Fear & Greed: ${fg.value} (${fg.label}); ${lines}` : lines;
}
```

Apply the same two-line change (import `getFearGreed`, prepend line) to the `latestNewsDigest` helper in `src/lib/trading/analyze.ts` (it takes 4 items — keep that).

- [ ] **Step 4: Typecheck, test, commit**

Run: `npx tsc --noEmit` and `npm test` → clean.

```bash
git add src/lib/trading/engine.ts src/lib/trading/analyze.ts
git commit -m "feat: engine enforces kill switch/position cap; digests carry Fear & Greed"
```

---

### Task 4: Live intel — Finnhub news + Fear & Greed + refresh route

**Files:**
- Create: `src/lib/intel/news.ts`
- Create: `src/app/api/intel/refresh/route.ts`
- Modify: `.env` (add FINNHUB_API_KEY)

- [ ] **Step 1: Copy the Finnhub key**

Read `FINNHUB_API_KEY=...` from `C:/Users/Kannithi/CLAUDE WEB/stock-tracker/.env` and append the same line to `C:/Users/Kannithi/CLAUDE WEB/nexmind/.env`. (Never print the key into logs or commits — `.env` is untracked.)

- [ ] **Step 2: Create `src/lib/intel/news.ts`**

```ts
// SCOUT goes live — pulls real market news (Finnhub) and the crypto Fear & Greed
// index (alternative.me) into the same NewsItem/Setting stores the analysts read.

import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";

export interface NewsRefresh { inserted: number; skipped: number; error?: string }

interface FinnhubItem {
  id: number; headline: string; summary: string; url: string; datetime: number; source: string;
}

export async function refreshFinnhubNews(): Promise<NewsRefresh> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { inserted: 0, skipped: 0, error: "FINNHUB_API_KEY not set" };

  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
  if (!res.ok) return { inserted: 0, skipped: 0, error: `Finnhub HTTP ${res.status}` };

  const newest = ((await res.json()) as FinnhubItem[]).slice(0, 10);
  const existing = await prisma.newsItem.findMany({
    where: { url: { in: newest.map((i) => i.url) } },
    select: { url: true },
  });
  const seen = new Set(existing.map((e) => e.url));

  let inserted = 0;
  for (const it of newest) {
    if (!it.url || seen.has(it.url)) continue;
    await prisma.newsItem.create({
      data: {
        source: "Finnhub",
        title: it.headline,
        summary: it.summary || null,
        url: it.url,
        createdAt: new Date(it.datetime * 1000),
      },
    });
    inserted++;
  }
  return { inserted, skipped: newest.length - inserted };
}

export interface FearGreedResult { value: number; label: string }

export async function refreshFearGreed(): Promise<FearGreedResult | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/");
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { value: string; value_classification: string }[] };
    const d = body.data?.[0];
    if (!d) return null;
    const fg = { value: Number(d.value), label: d.value_classification };
    await setSetting("fearGreed", JSON.stringify({ ...fg, fetchedAt: new Date().toISOString() }));
    return fg;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Create `src/app/api/intel/refresh/route.ts`**

```ts
import { NextResponse } from "next/server";
import { refreshFinnhubNews, refreshFearGreed } from "@/lib/intel/news";

export async function POST() {
  const [news, fearGreed] = await Promise.all([refreshFinnhubNews(), refreshFearGreed()]);
  return NextResponse.json({ news, fearGreed });
}
```

- [ ] **Step 4: Verify live**

Restart the dev server (new Prisma client from Task 1), then:

Run: `curl -s -X POST http://localhost:3000/api/intel/refresh`
Expected: `{"news":{"inserted":<1-10>,"skipped":...},"fearGreed":{"value":...,"label":"..."}}`. Run twice — second call should show `inserted: 0` (dedupe works).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intel/news.ts src/app/api/intel/refresh/route.ts
git commit -m "feat: SCOUT live intel — Finnhub news + Fear & Greed refresh"
```

---

### Task 5: Pure position rules (TDD)

**Files:**
- Create: `src/lib/trading/positionRules.ts`
- Test: `src/lib/trading/positionRules.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/trading/positionRules.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, type OpenPosition } from "./positionRules";

const long: OpenPosition = { side: "long", entry: 100, sl: 95, tp1: 110, tp2: 120 };
const short: OpenPosition = { side: "short", entry: 100, sl: 105, tp1: 90, tp2: 80 };

test("holds between SL and TP1", () => {
  assert.deepEqual(decideAction(long, {}, 105), { kind: "hold" });
  assert.deepEqual(decideAction(short, {}, 95), { kind: "hold" });
});

test("full loss at SL before TP1", () => {
  assert.deepEqual(decideAction(long, {}, 94), { kind: "close", outcome: "loss", exit: 95 });
  assert.deepEqual(decideAction(short, {}, 106), { kind: "close", outcome: "loss", exit: 105 });
});

test("TP1 with a TP2 → partial close", () => {
  assert.deepEqual(decideAction(long, {}, 111), { kind: "partial-tp1", exit: 110 });
  assert.deepEqual(decideAction(short, {}, 89), { kind: "partial-tp1", exit: 90 });
});

test("TP1 without TP2 → legacy full win", () => {
  assert.deepEqual(decideAction({ ...long, tp2: null }, {}, 111), { kind: "close", outcome: "win", exit: 110 });
});

test("after partial: TP2 closes the rest as win", () => {
  // After the partial, manage.ts has moved sl → entry (100 / 100).
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 121), { kind: "close", outcome: "win", exit: 120 });
  assert.deepEqual(decideAction({ ...short, sl: 100 }, { tp1Hit: true }, 79), { kind: "close", outcome: "win", exit: 80 });
});

test("after partial: breakeven SL closes the rest as breakeven", () => {
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 99), { kind: "close", outcome: "breakeven", exit: 100 });
  assert.deepEqual(decideAction({ ...short, sl: 100 }, { tp1Hit: true }, 101), { kind: "close", outcome: "breakeven", exit: 100 });
});

test("after partial: holds between breakeven and TP2", () => {
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 115), { kind: "hold" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './positionRules'`.

- [ ] **Step 3: Implement `src/lib/trading/positionRules.ts`**

```ts
// Pure position-management ladder: given an open trade, its ladder state, and the
// current price, decide what to do. No I/O — trivially testable. manage.ts owns
// persistence (it moves SL to entry and banks the partial P/L).

export interface OpenPosition {
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2?: number | null;
}

export interface LadderState {
  tp1Hit?: boolean;
  partialPnl?: number; // banked half-lot P/L from the TP1 partial
  origSl?: number; // SL before it moved to breakeven (for R-multiple math)
}

export type PositionAction =
  | { kind: "hold" }
  | { kind: "close"; outcome: "win" | "loss" | "breakeven"; exit: number }
  | { kind: "partial-tp1"; exit: number }; // close half at TP1, move SL to entry

export function decideAction(t: OpenPosition, ladder: LadderState, price: number): PositionAction {
  const hitUp = (level: number) => (t.side === "long" ? price >= level : price <= level);
  const hitSl = t.side === "long" ? price <= t.sl : price >= t.sl;

  if (!ladder.tp1Hit) {
    if (hitUp(t.tp1)) {
      if (t.tp2 == null) return { kind: "close", outcome: "win", exit: t.tp1 };
      return { kind: "partial-tp1", exit: t.tp1 };
    }
    if (hitSl) return { kind: "close", outcome: "loss", exit: t.sl };
    return { kind: "hold" };
  }

  // After TP1: half is banked and SL sits at breakeven (entry).
  if (t.tp2 != null && hitUp(t.tp2)) return { kind: "close", outcome: "win", exit: t.tp2 };
  if (hitSl) return { kind: "close", outcome: "breakeven", exit: t.sl };
  return { kind: "hold" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/positionRules.ts src/lib/trading/positionRules.test.ts
git commit -m "feat: pure position ladder rules (TP1 partial, breakeven, TP2)"
```

---

### Task 6: manage.ts — wire in the ladder

**Files:**
- Modify: `src/lib/trading/manage.ts` (replace the decision block; keep `makePriceFetcher`, `safeParse`, `POINT_VALUE`)

- [ ] **Step 1: Update types + imports**

```ts
import { decideAction, type LadderState } from "./positionRules";

export interface CloseResult {
  id: number;
  symbol: string;
  outcome: "win" | "loss" | "breakeven";
  exit: number;
  price: number;
  pnl: number;
}

export interface PartialResult { id: number; symbol: string; exit: number; bankedPnl: number }

export interface ManageSummary {
  checked: number;
  closed: CloseResult[];
  partials: PartialResult[];
}
```

- [ ] **Step 2: Replace the per-trade body of `manageOpenTrades`**

```ts
export async function manageOpenTrades(): Promise<ManageSummary> {
  const open = await prisma.trade.findMany({ where: { status: "open" } });
  const priceOf = await makePriceFetcher();
  const closed: CloseResult[] = [];
  const partials: PartialResult[] = [];

  for (const t of open) {
    const cur = await priceOf(t.symbol);
    if (cur == null) continue;

    const ladder = safeParse<LadderState>(t.stagedTp, {});
    const action = decideAction(
      { side: t.side as "long" | "short", entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2 },
      ladder,
      cur,
    );
    if (action.kind === "hold") continue;

    const log = safeParse<{ stage: string; note: string }[]>(t.decisionLog, []);

    if (action.kind === "partial-tp1") {
      const favorable = t.side === "long" ? action.exit - t.entry : t.entry - action.exit;
      const banked = favorable * (t.lot / 2) * POINT_VALUE;
      const next: LadderState = {
        tp1Hit: true,
        partialPnl: (ladder.partialPnl ?? 0) + banked,
        origSl: ladder.origSl ?? t.sl,
      };
      log.push({ stage: "manage", note: `TP1 partial — half closed at ${action.exit.toFixed(4)}, SL → breakeven` });
      await prisma.trade.update({
        where: { id: t.id },
        data: { sl: t.entry, stagedTp: JSON.stringify(next), decisionLog: JSON.stringify(log) },
      });
      partials.push({ id: t.id, symbol: t.symbol, exit: action.exit, bankedPnl: banked });
      continue;
    }

    // Full close (win / loss / breakeven).
    const remainingLot = ladder.tp1Hit ? t.lot / 2 : t.lot;
    const favorable = t.side === "long" ? action.exit - t.entry : t.entry - action.exit;
    const pnl = (ladder.partialPnl ?? 0) + favorable * remainingLot * POINT_VALUE;
    const risk = Math.abs(t.entry - (ladder.origSl ?? t.sl));
    const rMultiple = risk > 0 ? pnl / (risk * t.lot * POINT_VALUE) : null;

    log.push({
      stage: "manage",
      note: `${action.outcome} — exit ${action.exit.toFixed(4)} (price ${cur.toFixed(4)})${ladder.tp1Hit ? " · incl. TP1 partial" : ""}`,
    });
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        outcome: action.outcome,
        pnl,
        rMultiple,
        closedAt: new Date(),
        decisionLog: JSON.stringify(log),
        stagedTp: JSON.stringify(ladder),
      },
    });
    closed.push({ id: t.id, symbol: t.symbol, outcome: action.outcome, exit: action.exit, price: cur, pnl });
  }

  return { checked: open.length, closed, partials };
}
```

Note: `Trade.outcome` already allows `"breakeven"` per the schema comment. `computeStats` treats pnl numerically, so breakeven (≈0) needs no change.

- [ ] **Step 3: Typecheck + test + commit**

Run: `npx tsc --noEmit` and `npm test` → clean. (`/api/manage` returns the summary as-is, so `partials` flows through with no route change.)

```bash
git add src/lib/trading/manage.ts
git commit -m "feat: manage — TP1 partial close + breakeven SL via ladder rules"
```

---

### Task 7: Settings API + Safety panel UI

**Files:**
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/command/safety-panel.tsx`
- Modify: `src/app/command/page.tsx` (import + render next to `<WatchlistPanel />`, line ~155)

- [ ] **Step 1: Create `src/app/api/settings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions } from "@/lib/settings";

async function snapshot() {
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    maxOpenPositions: await getMaxOpenPositions(),
    fearGreed: await getFearGreed(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { killSwitch?: boolean; maxOpenPositions?: number };
  if (typeof body.killSwitch === "boolean") await setSetting("killSwitch", String(body.killSwitch));
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  return snapshot();
}
```

- [ ] **Step 2: Create `src/app/command/safety-panel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Settings {
  killSwitch: boolean;
  maxOpenPositions: number;
  fearGreed: { value: number; label: string } | null;
}

export function SafetyPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setS(await fetch("/api/settings").then((r) => r.json()));
  }
  useEffect(() => { void load(); }, []);

  async function update(patch: Partial<Settings>) {
    setBusy(true);
    try {
      setS(await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json()));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>🛡️ Safety</CardTitle>
        {s.fearGreed && <Badge tone="info">F&G {s.fearGreed.value} · {s.fearGreed.label}</Badge>}
      </div>
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
      <div className="flex items-center gap-2 mt-3">
        <label className="text-xs text-(--color-muted)">Max open positions</label>
        <input
          type="number"
          min={1}
          value={s.maxOpenPositions}
          disabled={busy}
          onChange={(e) => update({ maxOpenPositions: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Render it on Command Bridge**

In `src/app/command/page.tsx`: add `import { SafetyPanel } from "./safety-panel";` and render `<SafetyPanel />` immediately before `<WatchlistPanel />` (~line 155).

- [ ] **Step 4: Verify in the browser**

With the dev server running, open `/command`: Safety card shows "Trading enabled" + F&G badge (after Task 4 refresh ran). Click EMERGENCY STOP → state flips to "TRADING HALTED". Then `curl -s -X POST http://localhost:3000/api/trade-tick -H "Content-Type: application/json" -d '{"symbol":"GC=F"}'` — if the scanner finds a setup, the tick must end `rules-blocked` with "kill switch engaged". Toggle back off.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts src/app/command/safety-panel.tsx src/app/command/page.tsx
git commit -m "feat: settings API + Safety panel (emergency stop, position cap, F&G badge)"
```

---

### Task 8: Orchestrator bot — `scripts/bot.ts`

**Files:**
- Create: `scripts/bot.ts`
- Modify: `package.json` (add `"bot"` script)

- [ ] **Step 1: Create `scripts/bot.ts`**

```ts
// NEXMIND orchestrator bot — schedules the desk against a running app server.
// All logic lives in the app; this script only decides WHEN to call it.
//   manage  every 5 min  (always — open positions must close even when halted)
//   scan    every 15 min (skipped while the kill switch is on)
//   intel   every 30 min (news + Fear & Greed)
// Run: npm run bot   (NEXMIND_URL overrides http://localhost:3000)

const BASE = process.env.NEXMIND_URL ?? "http://localhost:3000";
const MINUTE_MS = 60_000;

type Json = Record<string, unknown>;

function log(job: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${job.padEnd(6)} ${msg}`);
}

async function post(path: string): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as Json;
}

async function killSwitchOn(): Promise<boolean> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) return false; // fail open for reads; iron rules enforce server-side anyway
  return ((await res.json()) as { killSwitch?: boolean }).killSwitch === true;
}

async function runManage() {
  const r = await post("/api/manage");
  const closed = Array.isArray(r.closed) ? r.closed.length : 0;
  const partials = Array.isArray(r.partials) ? r.partials.length : 0;
  log("manage", `checked ${r.checked ?? 0} · closed ${closed} · partials ${partials}`);
}

async function runScan() {
  if (await killSwitchOn()) {
    log("scan", "kill switch on — skipped");
    return;
  }
  const r = await post("/api/scan-all");
  log("scan", `scanned ${r.scanned ?? 0} · executed ${r.executed ?? 0} · cost $${Number(r.totalCostUsd ?? 0).toFixed(4)}`);
}

async function runIntel() {
  const r = (await post("/api/intel/refresh")) as {
    news?: { inserted?: number };
    fearGreed?: { value: number; label: string } | null;
  };
  const fg = r.fearGreed ? `${r.fearGreed.value} (${r.fearGreed.label})` : "n/a";
  log("intel", `news +${r.news?.inserted ?? 0} · F&G ${fg}`);
}

const jobs = [
  { name: "manage", every: 5, run: runManage },
  { name: "scan", every: 15, run: runScan },
  { name: "intel", every: 30, run: runIntel },
];

let minutes = 0;
async function tick() {
  minutes++;
  for (const job of jobs) {
    if (minutes % job.every !== 0) continue;
    try {
      await job.run();
    } catch (e) {
      log(job.name, `ERROR ${(e as Error).message}`);
    }
  }
}

console.log(`NEXMIND bot → ${BASE} (manage 5m · scan 15m · intel 30m). Ctrl+C to stop.`);
void (async () => {
  // Run every job once at startup so output is immediate and wiring problems surface now.
  for (const job of jobs) {
    try {
      await job.run();
    } catch (e) {
      log(job.name, `ERROR ${(e as Error).message}`);
    }
  }
})();

const timer = setInterval(() => void tick(), MINUTE_MS);
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("\nbot stopped");
  process.exit(0);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, after `"db:studio"`: `"bot": "tsx scripts/bot.ts",`

- [ ] **Step 3: Verify one startup cycle**

With the dev server running: `npm run bot` → three log lines (intel/manage/scan) with real numbers, no ERROR. Ctrl+C stops cleanly. If the kill switch was left on from Task 7 testing, scan logs "kill switch on — skipped" — that is correct behavior.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add scripts/bot.ts package.json
git commit -m "feat: orchestrator bot loop (manage 5m / scan 15m / intel 30m)"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Full test suite** — `npm test` → all pass (iron rules 10, position rules 7, guardrails 9).
- [ ] **Step 2: Build** — `npm run build` → succeeds (clear `.next` first if stale-route types complain).
- [ ] **Step 3: Live pass** — dev server + `npm run bot` running ≥1 minute: startup cycle clean; `/command` Safety panel reflects toggles; `/` War Room shows fresh Finnhub items in the SCOUT feed.
- [ ] **Step 4: Update memory** — note in the NEXMIND memory file: bot loop (`npm run bot`), Setting model, kill switch behavior (manage still runs), partial-close ladder (stagedTp), intel refresh route.
