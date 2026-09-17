# Gold MT5 pipeline — manual verification runbook

Everything in this module that talks to a real MT5 terminal (i.e. exercises
`mt5-bridge/bridge.py` itself) cannot run in CI — see spec
`docs/superpowers/specs/2026-09-16-gold-mt5-pipeline-design.md` §4. This
runbook is the verification for `scripts/gold-desk.mts` and
`scripts/gold-manual-order-test.mts`, both of which have no automated test.

Run all of the below against a **demo account only**. Do not set
`MT5_BRIDGE_ALLOW_REAL=1`.

## Prerequisites

1. Start the bridge: `python mt5-bridge/bridge.py` (needs
   `MT5_BRIDGE_SECRET` and, to allow the write path,
   `MT5_BRIDGE_ALLOW_TRADING=1`).
2. In NEXMIND's `.env`, set `MT5_BRIDGE_SECRET` to match.
3. `npm run gold` should report "ready" with the correct open-position count.

## Place-order + boot reconciliation

1. `npx tsx scripts/gold-manual-order-test.mts place buy 0.01 smoke-test-1`
2. Confirm the fill appears in the MT5 terminal's Trade tab.
3. `npx tsx scripts/gold-manual-order-test.mts positions` — confirm it lists
   the new position.
4. Restart the bridge process, then `npm run gold` again — confirm boot
   reconciliation still reports the position (proves reconciliation reads
   real state, not anything cached client-side).
5. `npx tsx scripts/gold-manual-order-test.mts close <magic>` — confirm the
   position closes in the terminal.

## Hard kill test (IN_FLIGHT_UNKNOWN resolver)

1. `npx tsx scripts/gold-manual-order-test.mts place buy 0.01 smoke-kill-1`
2. Immediately `kill -9` the bridge.py process, before the CLI prints a
   result.
3. Restart the bridge.
4. Confirm the CLI eventually prints either `{"status":"sent",...}` (if the
   order reached the broker before the kill) or throws
   `GoldOrderUnresolvedError` (if it did not) — never a silent hang, and
   never two positions opened for the same label.

## Terminal lag / desync test (DEGRADED staleness)

1. With the bridge running, disconnect the MT5 terminal's network or log it
   out of the account.
2. Call `checkBridgeHealth()` (e.g. via `npm run gold` or the optional
   `/api/gold/status` route) — confirm it reports `connected: false` rather
   than silently reusing the last-known state.
3. Reconnect and confirm it reports `connected: true` again.

## Known unconfirmed assumptions (see `src/lib/gold/marketData.ts`)

- `DEFAULT_EET_EEST_SCHEDULE`'s DST transition dates (last Sunday of
  March/October, 01:00) and offsets (+2h / +3h) are the textbook EET/EEST
  rule, not yet confirmed against this broker's actual server-time
  behavior.
- `DEFAULT_WEEKLY_CLOSURE`'s Friday-21:00-UTC / Sunday-21:00-UTC session
  boundary is a first approximation, not yet confirmed against this
  broker's actual weekend gap.

Confirm both against a real demo session before relying on gap
classification for anything beyond this pipeline's own tests.
