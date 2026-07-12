---
type: desk-decision
date: 2026-07-06
portfolios: [8, 13]
tags: [desk, gold, merge]
---

# Gold Desk Merge (#8 + #13)

Merged **Gold Desk** (#8, `combo-gold` strategy, 1d/5y) and **Gold Trend Desk** (#13, [[DI-Dominance Widening]] / `research-30`, 1h/3mo) into one shared book on #8. Both strategies now scan and can trade GC=F concurrently; #13 is archived.

## Why safe to merge

Both desks' watchlists only ever contain GC=F, and `runTradeTick`'s one-open-position-per-symbol dedupe rule (`src/lib/trading/engine.ts`) means whichever strategy signals first "owns" the symbol until that trade closes — no double-risking.

## Where the merge lives

Single source of truth: `src/lib/trading/secondaryPasses.ts` (`SECONDARY_PASSES` array — portfolio id, strategy key, interval, range, label). Consumed by three call sites:

1. `src/app/api/scan-all/route.ts` — accepts per-request `{strategy, interval, range}` overrides.
2. `src/app/command/watchlist-panel.tsx` — dashboard "Scan all" button, runs default + every matching secondary pass, tags results per-pass in the UI.
3. `scripts/scan.mts` — **the actual production path**, driven by Windows Task Scheduler (`node --import tsx scripts/scan.mts 8 13`). This one matters most: it calls `runTradeTick` directly in-process, bypassing HTTP entirely.

## A costly early mistake

Initially only fixed `scripts/bot.ts` (an alternate HTTP-polling scheduler) + the dashboard button, assuming that was "the" production scheduler. It wasn't — Task Scheduler actually runs `scan.mts`, a separate script that was never touched by the first fix. Caught by noticing a log-format/timestamp mismatch in a pasted scan result that didn't match anything the first fix could have produced. Traced via `src/app/activity/page.tsx` (reads `scripts/scan.log`) → the log file itself → a repo-wide grep for the distinctive `"skipped (kind=...)"` string → `scripts/scan.mts`.

**Lesson:** when a script *could* be the production driver, check what's actually invoking it (Task Scheduler / cron / systemd) before assuming — a script "existing and looking right" isn't proof it's live.

## Loose end

Task Scheduler's job still passes `13` as an argument even though desk #13 is archived — harmless (just logs `skipped (kind=swing, status=archived)` each cycle) but could be simplified to just `8`. Not changed yet — editing the scheduled task itself is an OS-level, external-system action outside the repo.
