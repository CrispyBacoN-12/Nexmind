# Levels Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move support/resistance to its own local-only `/levels` page. It shows one searched ticker at a time on an interactive TradingView-style candle chart.

**Architecture:**
- Pure, tested helpers in `src/lib/levels/chart.ts`: the chart series, the range-button start, and the band geometry.
- A new route `/api/levels` needs a ticker and returns one row with the full 2-year OHLCV series.
- The client page draws the chart with `lightweight-charts` 5.2.1. Zones are drawn by a small series primitive that calls the tested band helper.
- The old levels section and the recharts chart under /portfolio are deleted.

**Tech Stack:** Next.js 16, TypeScript, node:test via tsx, lightweight-charts 5.2.1 (exact pin).

**Spec:** `docs/superpowers/specs/2026-11-25-levels-page-design.md`

## Global Constraints

- **Local only.**
  - The page renders `ใช้ได้เฉพาะบนเครื่อง` when `isDeployed() || !isLocalRequest(headers)`.
  - Under that same check, the API returns 404 `{ ok:false, error:"not found" }`.
- The sidebar shows the `/levels` entry only when not on Vercel. It uses the existing `showPortfolio` flag, which the layout sets to `!process.env.VERCEL`.
- `lightweight-charts` is pinned exactly to `5.2.1`. Its attribution logo stays at the default (on).
- **Zone math unchanged.** `computeLevels` is called as-is.
- **Copy.**
  - Thai, descriptive only, never buy/sell wording.
  - The footer string `FOOTER` moves unchanged from `levels-section.tsx`.
- Colours:
  - support `#10b981`
  - resistance `#f43f5e`
  - price-inside `#f59e0b`
  - fill opacity 0.18, or 0.08 when the zone is stale
  - cost line `#a78bfa` dashed, titled `ทุน`
  - MA50 `#60a5fa`, MA200 `#94a3b8`
- The default view is the last 6 months. The range buttons are `3M` `6M` `1Y` `2Y`.
- Never commit `.local/` or `obsidian-vault/`. Stage files by path.

## Review Focus

1. **Duplicate or unsorted timestamps from the data feed.** `setData` in lightweight-charts throws unless times strictly ascend, and the page would go blank. `chartSeries` must return strictly ascending, de-duplicated `t`. Pinned in Task 1.
2. **Searching a second ticker.** The old chart must be removed and recreated, with no leftover bands, cost line or crosshair handler. The effect cleanup calls `chart.remove()`. Checked in the Task 3 browser step.
3. **A ticker with no data** (typo, delisted). Show `ไม่พบข้อมูลราคา` and draw no chart. Short history (under 60 bars) still shows candles, and the zone strip says `ประวัติราคาไม่พอ`. Pinned in Task 1 (an empty series) and checked in Task 3.
4. **A band partly or wholly off-screen** after zoom or pan. Clip it to the pane, and skip it when it is fully outside or a coordinate is null. Pinned in Task 1 (`bandRects`).
5. **Range button on a short series.** When 2Y is pressed on 8 months of data, start at the first bar and never before it. Pinned in Task 1 (`rangeStart`).

---

### Task 1: Pure chart helpers

**Files:**
- Create: `src/lib/levels/chart.ts`
- Test: `src/lib/levels/chart.test.ts`

**Interfaces:**
- Consumes: `completedBars(candles, nowSec)` from `./levels`; `sma` and `Candle` from `@/lib/indicators`; `Zone` from `./levels`.
- Produces:
  - `export interface ChartBar { t: number; o: number; h: number; l: number; c: number; v: number; ma50: number | null; ma200: number | null }`
  - `export function chartSeries(candles: Candle[], nowSec: number): ChartBar[]`
    - All completed bars, then the forming bar (if any) with `ma50` and `ma200` set to null.
    - Bars with a non-finite o/h/l/c are dropped.
    - The result has strictly ascending `t`. On a duplicate `t`, keep the later bar.
    - MAs are computed on the cleaned completed closes.
  - `export type RangeKey = "3M" | "6M" | "1Y" | "2Y"`
  - `export function rangeStart(bars: ChartBar[], key: RangeKey): number | null`
    - Returns the `t` of the first bar at or after (last `t` − 63/126/252/504 × 86400 × 7/5 seconds), meaning that many trading days converted to calendar time.
    - Never earlier than `bars[0].t`. Returns null for an empty series.
  - `export interface BandRect { top: number; bottom: number; color: string; opacity: number }`
  - `export function bandColor(z: Zone, price: number): string`
    - `#10b981` when `z.high < price`, `#f43f5e` when `z.low > price`, else `#f59e0b`.
  - `export function bandRects(zones: Zone[], price: number, toY: (p: number) => number | null, paneHeight: number): BandRect[]`
    - `top = toY(z.high)` and `bottom = toY(z.low)`, clipped to [0, paneHeight].
    - Skip the zone when either coordinate is null, or when it is entirely above 0 or below paneHeight.
    - Opacity is 0.08 when `z.stale`, else 0.18.

- [ ] **Step 1: Write the failing tests** in `chart.test.ts`, using synthetic candles built like `levels.test.ts`'s `bar()`:
  - `chartSeries: completed bars then the forming bar, MAs aligned`
    - 260 bars with `nowSec` after 16:00 ET on the last bar's day: length 260 and every bar has `forming` absent.
    - `ma50` is null for indexes 0..48 and equals the mean of closes 0..49 at index 49.
    - `ma200` is non-null from index 199.
    - With `nowSec` at 12:00 ET on the last bar's date: the length is still 260, the last element's `ma50 === null`, and the second-last's `ma50 !== null`.
  - `chartSeries: drops non-finite bars and de-duplicates timestamps`
    - Input `[b0, b1, b1' (same t as b1, c changed), b2 with h=NaN, b3]`.
    - The output `t` values equal `[b0.t, b1.t, b3.t]`, and the `b1` entry has `b1'.c`.
  - `chartSeries: empty → []`.
  - `rangeStart: picks the first bar inside the window and clamps to the series`
    - 600 daily-stepped bars (`t` = T0 + i·86400).
    - `rangeStart(bars,"3M") === bars.find(b => b.t >= last − 63·86400·7/5).t`.
    - For a 100-bar series, `rangeStart(bars,"2Y") === bars[0].t`.
    - `rangeStart([], "6M") === null`.
  - `bandRects: clips, skips off-pane and null, fades stale`
    - Use `toY = p => 1000 − p·5` (price 100 → y 500) and `paneHeight = 600`.
    - A zone 90–95 below price 100: green, `top = 525`, `bottom = 550`.
    - A zone 210–220: y −100..−50, entirely above the pane, skipped.
    - A zone 195–205: `top` clipped to 0.
    - A zone with `toY` returning null: skipped.
    - A stale zone has opacity 0.08.
    - A zone 98–102 at price 100: amber.

- [ ] **Step 2: Run it and watch it fail**
  Run: `npx tsx --test src/lib/levels/chart.test.ts`
  Expected: FAIL, cannot find module `./chart`.

- [ ] **Step 3: Implement `src/lib/levels/chart.ts`** to the Interfaces above.

- [ ] **Step 4: Run it and watch it pass**
  Run: `npx tsx --test src/lib/levels/chart.test.ts`
  Expected: all pass.

- [ ] **Step 5: Commit** `feat(levels): pure chart helpers (OHLCV series, range start, band geometry)`

### Task 2: `/api/levels` route

**Files:**
- Create: `src/app/api/levels/route.ts`
- Delete: `src/app/api/portfolio/levels/route.ts`

**Interfaces:**
- Consumes: `chartSeries` (Task 1); `computeLevels`; `fetchCandlesBatch(tickers, "2y", "1d")`; `TICKER_RE`; `readHoldings`; `isDeployed`; `isLocalRequest`.
- Produces: `GET /api/levels?ticker=X`, returning:
  - `{ ok: true, asOf: string, row: { ticker, held: boolean, avgCost: number | null, result: LevelsResult | { note: "noData" }, series: ChartBar[] } }`
  - a missing or invalid ticker: 400 `{ ok:false, error:"Enter a ticker symbol, e.g. AAPL." }`
  - not local: 404
  - a thrown error: 500 with the message cut to 120 chars, as before

- [ ] **Step 1: Write the route.**
  - Use the old route's guard and error handling. Drop the no-ticker "all holdings" mode.
  - `series` is always `chartSeries(candles, nowSec)`.
- [ ] **Step 2: Delete the old route** and remove its import site. `src/app/portfolio/levels-section.tsx` is deleted in Task 3, so tsc stays red until then; this is expected and accepted.
- [ ] **Step 3: Verify.** This runs in Task 3's browser step, because the page is the only caller. Also run `npx tsc --noEmit`. Expected: errors only from `src/app/portfolio/levels-section.tsx`.
- [ ] **Step 4: Commit** `feat(levels): /api/levels — one ticker, full 2-year OHLCV`

### Task 3: `/levels` page, chart, sidebar; remove from /portfolio

**Files:**
- Create:
  - `src/app/levels/page.tsx`: server component with the local-only guard and `PageHeader title="แนวรับ–แนวต้าน"`.
  - `src/app/levels/levels-panel.tsx`: client component. Holds the search box, header strip, chart, zone list and footer.
  - `src/app/levels/candle-chart.tsx`: client component that owns the lightweight-charts instance.
  - `src/app/levels/zone-bands.ts`: the `ISeriesPrimitive` that draws `bandRects`.
- Modify:
  - `src/components/sidebar.tsx`: add `{ href: "/levels", label: "Levels", icon: CandlestickChart }` beside Portfolio, under the same `showPortfolio` flag. Use lucide's `CandlestickChart`, or the closest candle icon the installed lucide version exports.
  - `src/app/portfolio/portfolio-panel.tsx`: remove the `LevelsSection` import and mount.
  - `package.json` / `package-lock.json`: `lightweight-charts` `5.2.1` (installed).
- Delete: `src/app/portfolio/levels-section.tsx`, `src/app/portfolio/levels-chart.tsx`

**Interfaces:**
- Consumes: Task 2's response; `ChartBar`, `RangeKey`, `rangeStart`, `bandRects` and `bandColor` from Task 1.
- `CandleChart` props: `{ series: ChartBar[]; zones: Zone[]; price: number; avgCost: number | null }`.

Behaviour (the spec's "The page" section):
- **Panel**
  - A search input and a `ดูหุ้นตัวนี้` button; Enter also submits.
  - Only the latest searched row is shown.
  - `noData` shows `ไม่พบข้อมูลราคา`.
  - The header strip shows ticker, price, the `ระหว่างวัน` badge when forming, and the nearest support and resistance with % distance. Reuse the existing `dist` / `NoneText` / `evidence` helpers, moved over.
  - `shortHistory` shows `ประวัติราคาไม่พอ` in place of the zones, but the candles still render.
  - The zone list and the MA/52-week strip are the old `Detail` without its chart.
- **Chart (`candle-chart.tsx`)**
  - Created in `useEffect` on a `div` ref, with `autoSize: true` and a height of 420px.
  - Colours come from the CSS variables of the current theme, read with `getComputedStyle`.
  - Series:
    - `CandlestickSeries` with up `#10b981`, down `#f43f5e`
    - `LineSeries` MA50 and MA200 (lineWidth 1, no price line, no last-value label)
    - `HistogramSeries` volume on an overlay price scale with `scaleMargins { top: 0.8, bottom: 0 }`
  - Times are passed as `UTCTimestamp`.
  - `ZoneBands` is attached to the candle series.
  - When `avgCost != null`, call `createPriceLine({ price: avgCost, color: "#a78bfa", lineStyle: Dashed, title: "ทุน", axisLabelVisible: true })`.
  - The legend is an absolutely positioned div at top-left showing date, O, H, L, C and V. It is updated from `subscribeCrosshairMove`, and falls back to the last bar.
  - The range buttons call `timeScale().setVisibleRange({ from: rangeStart(...), to: last t })`. The initial view is `6M`.
  - The effect depends on `series`, `zones`, `price` and `avgCost`. Its cleanup unsubscribes and calls `chart.remove()`.
- **ZoneBands**
  - Implements `ISeriesPrimitive<Time>`.
  - `attached({ series, requestUpdate })` stores the series.
  - `paneViews()` returns one view with `zOrder() → "bottom"`.
  - Its renderer draws in bitmap space. It fills each `BandRect` full-width with `bandRect.color` at `bandRect.opacity`.
  - `toY` is `series.priceToCoordinate`, and the pane height is the media height.

- [ ] **Step 1:** Write the four files, edit the sidebar and the portfolio panel, and delete the two old files.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Run `npx tsx --test "src/**/*.test.ts"`. Expected: all pass. The count is the previous 1313 plus Task 1's new tests.
- [ ] **Step 4: Browser check.** Use `preview_start nexmind-dev-web`, then open `/levels`.
  - Search `NVDA`: candles, volume, MA lines and bands render, and the legend updates on hover.
  - Wheel zoom and drag pan work.
  - 3M and 2Y change the range.
  - Search a holding from `.local/holdings.json`: the `ทุน` line appears. Do not print or commit the holding.
  - Search a second ticker: the old bands are gone, and there are no console errors.
  - Search `ZZZZZZ`: shows `ไม่พบข้อมูลราคา` or the API error, with no crash.
  - `/portfolio` no longer has the levels section.
  - Check dark and light themes, and take a screenshot.
- [ ] **Step 5: Commit** `feat(levels): own /levels page with a TradingView-style candle chart`

### Task 4: Docs

- [ ] Edit `docs/STATE.md` §3 with the Edit tool. Add an entry: levels moved to local-only `/levels`; one ticker per search; lightweight-charts 5.2.1; `/api/portfolio/levels` replaced by `/api/levels`.
- [ ] Commit `docs(state): levels page`.
