# Support / resistance zones on /portfolio (and removing the put card): design

- Date: 2026-11-25. Status: draft, awaiting owner approval.
- Owner's words:
  - "เอา fn option ออกแล้วสร้างระบบวิเคราะห์แนวรับแนวต้านของหุ้นแต่ละตัว"
  - Purpose: "ใช้ในการประกอบการตัดสินใจเข้าซื้อ/TP"
  - Picked approach 1: code-computed zones from daily charts.

## Intent

The owner holds about 19 US stocks (see /portfolio, local-only) and keeps buying (DCA). They want,
for each holding and for any ticker they are considering:
- **support zones** below the price, to inform where to buy
- **resistance zones** above it, to inform where to take profit

**Descriptive only.** NEXMIND's own research has not shown that these levels predict a bounce, and
the sweep/level rules were REJECTED. The page says where price *has* turned or traded heavily. It
never says a level "will hold", never says "buy here" or "sell here", and never scores a probability.

## Part A: remove the put card (owner's request)

- Delete `src/lib/hedge/` (math, alpacaPuts, card, types and their tests),
  `src/app/api/journal/hedges/route.ts`, `src/app/journal/hedge-section.tsx` and its mount in
  `journal-panel.tsx`.
- `worstGapDownPct` is used by /portfolio's earnings section. It moves, with its test cases, to
  `src/lib/portfolioRisk/gaps.ts`.
- The STATE entry for the put card is updated to say it was removed on 2026-11-25. Git history keeps it.

## Part B: levels

### Goals

1. A "แนวรับ–แนวต้าน" section on /portfolio. A button computes zones for every holding in one request.
   It is fast: candles only, no Finnhub, no pacing.
2. A ticker box in the same section to compute zones for any symbol, held or not.
3. Per ticker:
   - the last close and its date
   - the nearest support and resistance zones (range, % distance)
   - an expandable detail: all qualifying zones, MA50 / MA200, the 52-week high/low, and a mini chart
     with the zones drawn
4. For held tickers, each zone is marked as above or below the owner's average cost, and the cost line
   is drawn on the chart. The cost basis is what the owner compares a TP against.

### Non-goals

- Buy/sell signals, alerts, Discord, probabilities, back-tests, AI commentary.
- Intraday levels (prior-day POC/VAH, pre-market): those belong to the chart agent.
- Options of any kind.

### Anti-goals

- A level shown without its evidence (touches, last touch date, volume share).
- A two-year-old level looking as fresh as last week's.
- More than 3 zones per side in the summary: the summary must stay readable.
- Advice wording.

### Data

- `fetchCandlesBatch(tickers, "2y", "1d")`, one batch for all tickers.
- The current price is the last bar's close, labelled with its date. No live quote, so no Finnhub
  calls and no pacing: zones are daily-scale, and a few minutes of staleness does not move them.

### Algorithm (Claude's calls, all constants named and tested)

1. **ATR:** `atr(candles, 14)` at the last bar. It sets every distance below.
2. **Swing pivots** over the whole 2-year series.
   - A pivot high is a bar whose high is strictly greater than the highs of `PIVOT_SIDE = 5` bars on
     each side; pivot lows are the mirror.
   - The last 5 bars cannot be pivots.
   - Each pivot keeps its price and date.
3. **High-volume nodes (HVN)** over the last `HVN_BARS = 126` bars (about 6 months).
   - Split the price range into `HVN_BINS = 50` bins.
   - Each bar's volume is spread evenly over the bins its low–high range covers.
   - A bin is an HVN when it is a local maximum and its volume is ≥ `HVN_MIN_RATIO = 1.5` × the
     median bin volume.
   - Each HVN keeps its bin range and its share of the period's volume.
4. **Zones:** pivots and HVN centres are merged into zones.
   - Sort every point by price.
   - Walk upward. A point joins the current zone if it is within `ZONE_JOIN_ATR = 0.5` × ATR of the
     zone's running mean and the zone's span stays ≤ `ZONE_MAX_ATR = 1.0` × ATR.
   - Otherwise it starts a new zone.
   - Each zone has:
     - `low`, `high` (the min/max of its points; an HVN contributes its bin bounds)
     - `touches` (number of pivots, highs and lows both count)
     - `lastTouch` (newest pivot date)
     - `volumeShare` (sum of HVN shares inside it)
     - `sources`
5. **Qualifying zones:** keep a zone if any of these holds:
   - `touches ≥ 2`
   - `volumeShare > 0` (it contains an HVN)
   - its newest pivot is within the last `RECENT_BARS = 60` bars
6. **Side:**
   - support: zone `high` < price
   - resistance: zone `low` > price
   - a zone containing the price is reported as **"ราคาอยู่ในโซน"**
7. **Summary:** the nearest 3 qualifying zones on each side, by distance from the price.
   - If a side has none (e.g. at a 2-year high), it says
     "ไม่มีแนวต้านในช่วง 2 ปี (ราคาใกล้จุดสูงสุด)", or the support equivalent.
8. **Reference lines (not zones):** MA50 and MA200 (null under enough bars) and the 52-week high/low.
9. **Short histories:** a ticker with fewer than `MIN_BARS = 60` bars (e.g. a recent IPO) returns
   "ประวัติราคาไม่พอ" plus whatever reference lines exist.

### Surface

- `GET /api/portfolio/levels`
  - Without query: all holdings from the local file.
  - With `?ticker=XYZ`: that one ticker; the ticker is validated with `TICKER_RE`.
  - Same local-only guard as the other /portfolio routes: `isDeployed`, `isLocalRequest`.
  - `dynamic = "force-dynamic"`.
- UI in `src/app/portfolio/`:
  - A levels section with the button and the ticker box.
  - A summary table, one row per ticker: last close (date), nearest support with −%, nearest
    resistance with +%, and an "in zone" badge.
  - A row expands to a zone list, the reference lines and a recharts mini chart: 1 year of closes,
    zones as shaded bands, MA50/MA200 lines, the cost line for holdings.
  - Footer, verbatim: "แสดงว่าราคาเคยกลับตัวหรือซื้อขายหนาแน่นตรงไหน ไม่ได้บอกว่าแนวจะรับหรือต้านได้ ข้อมูลประกอบการตัดสินใจเท่านั้น".

### Calls made after the builder check (Claude's calls)

1. **Price adjustment.**
   - Alpaca bars use `adjustment=all` (split + dividend; `src/lib/alpaca.ts`).
   - Broker cost bases are restated after a split, so split-adjusted bars and the owner's avg cost are on
     the same scale.
   - The dividend part lowers older prices by roughly the cumulative yield, about 1–2%/yr for most
     holdings. That is accepted, and stated once in the footer note: "ราคาย้อนหลังปรับปันผลแล้ว".
   - No raw-vs-adjusted check.
2. **Forming bar.**
   - Pivots, HVN, ATR and MAs use **completed bars only**. A bar dated today (America/New_York) before
     16:00 ET is dropped from the math.
   - The displayed price is still the newest bar's close. When that bar is forming, it is labelled
     "ระหว่างวัน", and support/resistance is judged against it.
3. **Thai strings:** Claude writes them, plain and descriptive.
   - Labels: "แนวรับ", "แนวต้าน", "ราคาอยู่ในโซน", "ประวัติราคาไม่พอ",
     "ไม่มีแนวรับในช่วง 2 ปี (ราคาใกล้จุดต่ำสุด)".
   - Sources: "จุดกลับตัว N ครั้ง" for pivots and "ซื้อขายหนาแน่น X%" for HVN.
   - No verbs like ซื้อ/ขาย/ควร.
4. **HVN in the walk.**
   - The join and span tests use the HVN **centre**. Its bin bounds only widen the zone's `low/high`.
   - A bin wider than 1×ATR contributes centre ± 0.5×ATR instead of its full bounds.
5. **Touches and age.**
   - Every pivot counts as one touch, highs and lows alike: a flip level counts both.
   - The summary is ordered by distance.
   - A zone whose `lastTouch` is more than 252 bars ago is labelled "เก่า (ล่าสุด <date>)".
6. **Ticker box.**
   - It uses the same Finnhub-free path.
   - "Held" means an exact upper-case match with a `holdings.json` ticker.
   - `TICKER_RE` (`/^[A-Z][A-Z.\-]{0,9}$/`) accepts dotted and dashed symbols. A provider that cannot
     resolve a symbol returns "ไม่พบข้อมูลราคา".
7. **Payload.**
   - `GET /api/portfolio/levels` (all holdings) returns the summary and zone lists **without** price series.
   - Expanding a row calls `GET /api/portfolio/levels?ticker=X&series=1`, which adds about 1 year of
     closes and the MA lines.
   - The ticker box uses the same call.
8. **Part A scope.**
   - `src/lib/portfolioRisk/analysis.ts` is the only importer of `src/lib/hedge` outside the files
     being deleted (verified by grep).
   - All of `src/lib/hedge/` goes, `alpacaPuts.ts` included. Nothing else in the app reads option data.

### Constraints

- Next.js 16: read `node_modules/next/dist/docs/` before routes and pages.
- TDD with node:test. The pure level math is tested on synthetic candles with made-up tickers.
- No holdings in committed files.
- No DB, no cron, no Finnhub in the levels path.
- Branch from master.
