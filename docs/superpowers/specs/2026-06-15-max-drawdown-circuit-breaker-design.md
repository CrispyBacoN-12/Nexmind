# Max Drawdown Circuit Breaker — Design

## Problem

The trading engine has a daily loss cap (`dailyLossCapUsd`, hardcoded $200 in
`DEFAULT_ACCOUNT`) that blocks individual trades once today's realized loss
hits it — but it resets every midnight and never halts the system. There is
no protection against a sustained losing streak that erodes the account
*overall*: the bot could keep trading indefinitely while equity slides further
and further below its peak.

## Goal

Add an overall **drawdown circuit breaker**: when realized account equity
drops more than a configurable percentage below its all-time peak, trip the
existing kill switch automatically and record why. The kill switch already
halts all new trades (Iron Rules checks `killSwitch`), so this reuses that
mechanism rather than introducing a parallel halt flag. The trip persists
until the user manually re-enables trading from the Safety panel — there is
no auto-recovery.

## Scope

- Drawdown is computed from **realized P/L of closed trades only**
  (`startingBalance + cumulative pnl`), the same methodology already used by
  `computeStats` for the Reports page's Max Drawdown / Sharpe / Sortino. No
  mark-to-market on open positions.
- The breaker is evaluated inside `manageOpenTrades()`, which already runs
  every 5 minutes unconditionally (even when the kill switch is on, so open
  positions can still close).
- Out of scope: per-symbol or per-day drawdown limits, auto-recovery /
  cooldown timers, mark-to-market equity.

## Components

### 1. `src/lib/trading/circuitBreaker.ts` (new, pure)

```ts
import type { ClosedTrade } from "./stats";

/**
 * Current drawdown as a percentage below the all-time equity peak.
 * 0 means equity is at or above its peak. Walks closed trades in
 * chronological order over startingBalance + cumulative pnl.
 */
export function currentDrawdownPct(closed: ClosedTrade[], startingBalance: number): number;
```

- Reuses the `ClosedTrade` type from `src/lib/trading/stats.ts` (same shape:
  `{ pnl, rMultiple, outcome, closedAt }`).
- Algorithm: sort by `closedAt` ascending, `equity = startingBalance`,
  `peak = startingBalance`; for each trade `equity += pnl`,
  `peak = max(peak, equity)`. Return `peak <= 0 ? 0 : Math.max(0, (peak - equity) / peak * 100)`.
- Empty input → `0`.

### 2. `src/lib/settings.ts` (additions)

```ts
export async function getDrawdownHaltPct(): Promise<number> {
  const n = parseFloat(await getSetting("drawdownHaltPct", "10"));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function getKillSwitchReason(): Promise<string> {
  return getSetting("killSwitchReason", "");
}
```

New `Setting` keys (no schema change — same key/value table used by
`riskPctPerTrade`, `maxOpenPositions`, etc.):
- `drawdownHaltPct` — default `"10"` (10%)
- `killSwitchReason` — default `""`

### 3. `src/lib/trading/manage.ts` (wiring)

At the end of `manageOpenTrades()`, after the existing close/partial loop:

```ts
const killSwitchOn = await isKillSwitchOn();
if (!killSwitchOn) {
  const [allClosed, startingBalance, haltPct] = await Promise.all([
    prisma.trade.findMany({ where: { status: "closed" }, select: { pnl: true, rMultiple: true, outcome: true, closedAt: true } }),
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
```

- Only evaluated when the kill switch is currently **off** — once tripped
  (manually or automatically), this block is skipped until the user turns it
  back off, satisfying "until manual reset" with no extra state.
- `ManageSummary` return type is unchanged; this is a side effect only (mirrors
  how `recordLesson` is a side effect of the close loop).

### 4. `src/app/api/settings/route.ts`

- GET `snapshot()` adds:
  - `drawdownHaltPct: await getDrawdownHaltPct()`
  - `killSwitchReason: await getKillSwitchReason()`
  - `currentDrawdownPct: currentDrawdownPct(<all closed trades>, await getStartingBalance())`
    — computed live for display even when the breaker hasn't tripped.
- POST body gains optional `drawdownHaltPct: number` (validated `> 0`, same
  pattern as `riskPctPerTrade`).
- POST: when the request body sets `killSwitch === false`, also
  `setSetting("killSwitchReason", "")` — manually re-enabling trading clears
  the auto-trip reason.

### 5. `src/app/command/safety-panel.tsx`

- `Settings` interface gains `drawdownHaltPct: number; killSwitchReason: string; currentDrawdownPct: number;`
- New "Max drawdown halt (%)" number input (`min={1}`, `step={1}`), same
  pattern as the existing "Risk per trade (%)" input, calling
  `update({ drawdownHaltPct: Number(e.target.value) })`.
- New read-only stat showing current drawdown, e.g. `Current drawdown: -3.2%`
  — `currentDrawdownPct` returns a non-negative number (3.2 means 3.2% below
  peak); the UI negates it for display, matching the sign convention of
  `PerfStats.maxDrawdownPct` on the Reports page. Always visible, not just
  when tripped.
- When `s.killSwitch && s.killSwitchReason`, render a warning banner near the
  kill switch toggle showing `s.killSwitchReason`, so the user can tell the
  halt was automatic rather than something they did.

## Testing

- `src/lib/trading/circuitBreaker.test.ts` (pure, following `stats.test.ts`
  conventions):
  - empty input → `0`
  - equity strictly increasing → `0` (never below peak)
  - simple drawdown: e.g. `+100, -50` from balance 1000 → peak 1100,
    equity 1050 → `~4.5%`
  - recovery after a drawdown doesn't reset the peak (peak stays at the
    highest point even after equity recovers partway)
  - multiple peaks/troughs — drawdown reflects the *current* gap to the
    all-time peak, not the largest historical drawdown
- No new tests for `manage.ts` wiring — it's I/O-heavy and untested by
  existing convention (same as `engine.ts`'s sizing wiring). Verified via
  `tsc --noEmit`, the existing suite, and a manual check against the dev DB
  (toggle `drawdownHaltPct` low, run `manageOpenTrades`, confirm `killSwitch`
  + `killSwitchReason` get set).
