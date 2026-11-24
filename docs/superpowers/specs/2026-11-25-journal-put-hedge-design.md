# Protective-put card per holding on /journal: design

- Date: 2026-11-25. Status: draft, awaiting owner approval.
- Owner's words: "ทำระบบที่ add หุ้นที่เราถืออยู่เข้าไปด้วย" + chose **ข** (show a put card for every
  holding, even under 100 shares, with an over-hedge warning and premium as % of position value)
  + chose **approach 1** (button on /journal).

## Intent

The owner holds a few stocks (capital about $2-3k). A stop order does not protect against a gap:
if a stock opens far below the stop (most often after earnings), the stop fills at the open, not at
the stop. The owner just learned that a protective put is insurance against exactly that, and wants
the copilot to show, for each stock they hold, what that insurance would cost and what it would
change — especially when earnings are coming.

This is a **risk display**, like the rest of the copilot. It never says a put is worth buying, never
claims an edge, never places an order (`ADVISOR_NO_EDGE_CLAIM` stance).

## Goals

1. On /journal, a button "เช็กประกัน put" that, when pressed, shows one card per **open journal
   position** (JournalTrade with `exitDate = null`).
2. Each card shows a few put contracts (strikes) for one chosen expiry, with per row:
   premium (ask) per contract and total, premium as % of position value, contracts needed, the
   over-hedge multiple, breakeven, max loss with the put, and the stop-only comparison.
3. The expiry is chosen around the next earnings date when there is one.
4. Every number that comes from a quote says it is an indicative quote and when it was taken.

## Non-goals

- Buying or selling options, or any order. No broker connection for options.
- Covered calls, spreads, collars, naked anything. Puts only.
- Recommending a strike or saying "buy" / "worth it". All rows are shown side by side, none is marked
  as the pick.
- Storing hedges in the DB. No schema change, no writes. Nothing is remembered between presses.
- Discord / Risk Sentry alert (approach 3). Possible later add-on, separate design.
- Positions that are only in Risk Sentry's manual extras list: they have no shares / entry / stop, so
  they get no card. The way to "add a held stock" is the existing journal "open" form, unchanged.
- Greeks or IV display, payoff charts.

## Anti-goals (would be a failure even if it works)

- A card that reads like advice ("protect with the 95 put"). Neutral wording only.
- A quote that looks firm. Indicative quotes can be stale or off; showing `$1.23` with no source and
  no time would mislead.
- Hiding the over-hedge. With 20 shares, one contract covers 100: the card must say "×5" loudly,
  not in a tooltip.
- A silent empty card: if a ticker has no options, no quote, or no earnings date, say why.

## Approaches considered

1. **Button on /journal, per open position (picked by owner).** Lives where the holdings are, runs only
   on demand, no cron, no DB writes. Cost: the owner has to remember to press it.
2. **A section on the /advisor card.** Fits pre-trade sizing for one ticker, not "everything I hold".
   Rejected: not what the owner asked for.
3. **Risk Sentry Discord line before earnings.** Automatic, but little room for detail, and Risk
   Sentry runs at 19:00 ICT before the US open, so option quotes would be yesterday's. Kept as a
   later add-on.

## Data

### Option quotes: Alpaca, indicative feed (free, existing keys)

`GET https://data.alpaca.markets/v1beta1/options/snapshots/{TICKER}` with
`feed=indicative&type=put&expiration_date_gte=…&expiration_date_lte=…&strike_price_gte=…&strike_price_lte=…&limit=1000`,
headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` from env `ALPACA_KEY` / `ALPACA_SECRET`.
Verified 2026-11-25 on AAPL: 200, filters work, `next_page_token` may be present (follow it, cap at
a few pages). Each snapshot has `latestQuote {ap, as, bp, bs, t}`; `greeks` / `impliedVolatility`
keys exist but are not used. Contract symbol format `AAPL261231P00240000`
(root, YYMMDD, P, strike×1000 zero-padded to 8) is parsed for expiry and strike.
`feed=opra` is 403 (paid) — do not use.

"Indicative" = Alpaca's delayed/derived quote, not the real NBBO. The broker's price can differ.

### Underlying price and gap history: existing `fetchCandlesBatch(tickers, "1y", "1d")`

- Current price: see "Calls made after the builder check" §1 (live quote, daily close as fallback).
- Worst overnight gap-down in the last year, as % = max over days of `(prevClose − open) / prevClose`.
  Used only for the stop-only comparison below.

### Earnings: existing `fetchNextEarnings(symbol)` (Finnhub, free)

Returns `{date, hour, note}`; a null date carries the reason, which the card shows.

## Rules (pure functions, all in `src/lib/hedge/`, unit-tested)

### Expiry choice

- If the next earnings date exists and is within 45 calendar days: the **first listed expiry strictly
  after** the earnings date (an expiry on the earnings day itself is not enough: an after-close report
  gaps the next morning). Label: "หมดอายุหลังประกาศงบ".
- Otherwise: the first listed expiry ≥ today + 30 days. Label: "ประมาณ 30 วัน".
- If no listed expiry fits (e.g. earnings far out, no chain): the card says no suitable expiry.

Implementation: one request for a date window (e.g. from the target date to target + 21 days), take
the earliest expiry in it.

### Strikes shown (up to 3, deduped, highest first)

Nearest listed strike to each target:
1. the position's journal **stop**
2. current price × 0.95
3. current price (at the money)

If two targets map to the same listed strike, show it once with both labels.

### Per row (shares = S, contracts N = ceil(S / 100), min 1, ask = A, strike = K, entry = E, stop = T, price = P)

- Premium total = A × 100 × N. If `ap` is missing or 0 → row says "ไม่มีราคาเสนอขาย", no math.
- Premium % of position value = premium total / (P × S).
- Over-hedge multiple = N × 100 / S. Shown loudly when > 1 (e.g. "คุม 100 หุ้น แต่ถือ 20 → เกิน ×5").
- Breakeven at expiry for the protected position = E + A × 100 × N / S
  (the stock has to climb back the premium spread over the shares held).
- Max loss with the put held to expiry = (E − K) × S + premium total (this holds for K > E too: the
  loss is then smaller than the premium). For S < 100×N the put pays more than the stock loses below K, so the loss can only shrink below K;
  the max is at price = K. State this in a line, not a chart.
- Stop-only, filled at the stop = (E − T) × S.
- Stop-only, gap case = (E − P×(1−g)) × S where g = the ticker's worst overnight gap-down of the
  last year, shown as "ถ้าเปิดกระโดดลงแรงเท่าครั้งที่แย่ที่สุดในรอบปี (−x%)". If gap data is missing,
  this line says so instead.

Quote age: show `latestQuote.t` in ICT. If older than 1 trading day's worth (> 4 days, to cover
weekends), mark it "ราคาเก่า".

## Surface

- `GET /api/journal/hedges` — reads open journal rows (ticker, shares, entryPrice, stop), fetches
  candles once (batch), earnings and option snapshots per ticker (sequential or small concurrency,
  few positions), returns per-ticker result objects. Fail-soft per ticker: one bad ticker never fails
  the others; an error is reported as a short reason, never raw upstream text beyond ~80 chars.
  `dynamic = "force-dynamic"`, `maxDuration = 60`. Read-only.
- /journal: a "เช็กประกัน put" button under the open-positions table. Pressing it fetches the route
  and renders one card per position. Not auto-run on load (unlike the stop check), because it makes
  several external calls per ticker.
- Fixed footer on the section: "ราคา option เป็นราคาประมาณการจาก Alpaca (indicative) ไม่ใช่ราคาจริงที่
  โบรกเกอร์ · 1 สัญญา = 100 หุ้น · นี่เป็นข้อมูลความเสี่ยง ไม่ใช่คำแนะนำให้ซื้อ · เช็กก่อนว่าบัญชีโบรกเกอร์
  ของคุณเทรด option สหรัฐฯ ได้".

Sketch of one card:

```
MSFT · 20 หุ้น · ทุน $410.00 · stop $395.00 · ราคาตอนนี้ $418.20 (23:41 ICT)
ประกาศงบ 2026-12-03 (หลังตลาดปิด) → put หมดอายุ 2026-12-05 (หมดอายุหลังประกาศงบ)
⚠ 1 สัญญาคุม 100 หุ้น แต่ถือ 20 → คุมเกิน ×5

strike   ค่าเบี้ย(ask)   รวม     % ของมูลค่าหุ้น   คุ้มทุน    ขาดทุนสูงสุดถ้ามี put
$395 (stop)  $1.85     $185      22.1%        $419.25     $485
$397.50 (−5%) …
$417.50 (ATM) …
stop อย่างเดียว: ขาดทุน $300 ถ้า fill ที่ stop · $1,0xx ถ้าเปิดกระโดดลงแรงเท่าครั้งที่แย่ที่สุดในรอบปี (−11.2%)
ราคา quote เมื่อ 2026-11-25 02:47 (ICT)
```

## Constraints

- Next.js 16 in this repo has breaking changes: read `node_modules/next/dist/docs/` for route handlers
  before writing the route.
- Tests: node:test via `npx tsx --test`, pure lib first (TDD).
- Never print or log `ALPACA_KEY` / `ALPACA_SECRET`; build headers from env only.
- No DB schema change, no writes, no cron (`vercel.json` stays `crons: []`).
- UI copy in Thai, matching /journal's existing style (`Badge`, `fmtMoney`, `text-(--color-muted)`).
- Branch from master (`journal-put-hedge`), not from `sweep-short-replay`.

## Left to the builder

- Exact request window sizes and page cap for the snapshot call.
- Concurrency for per-ticker fetches (positions are few; sequential is fine).
- Card layout details within the sketch above.
- Where exactly the types live inside `src/lib/hedge/`.

## Calls made after the builder check (Claude's calls, owner can overrule)

1. **Current price P = the price at the moment the button is pressed (owner's call, 2026-11-25).**
   - Source: the existing `fetchLiveQuote(symbol)` (Finnhub `/quote`, last trade, the same one
     /advisor's fill guard uses). The card prints the quote's time in ICT.
   - If the quote misses, fall back to the close of the newest daily bar, forming or not, and say so
     ("ใช้ราคาปิดแท่งล่าสุด <date> เพราะดึงราคาสดไม่ได้: <reason>").
   - Why live is fine here: the option quotes are also taken now, so the underlying and the put are
     priced at about the same moment. This is a display for a human, never research data.
   - Outside US hours (21:30–04:00 ICT, one hour earlier in US summer time) the "live" price is the
     last close; the quote time makes that visible.
   - Gap history still uses daily bars. Today's bar's open counts once the session has opened (that
     gap has already happened); its close is never used for the gap.
2. **Positions at or below their stop, or with stop ≥ entry, still get a card.**
   - The "stop" strike target is skipped when stop ≥ P (a put above the price is not insurance, it is
     already in the money), with a line saying "ราคาอยู่ต่ำกว่า stop แล้ว".
   - The stop-only lines are skipped when stop ≥ entry (the math assumes a long with stop < entry);
     the card says the stop is not below the entry.
   - When P < E, the breakeven line reads as written: it is a price the stock must get back to.
3. **Strike distance cap.** A target's nearest listed strike is used only if it is within 3% of
   the current price away from the target (|K − target| ≤ 0.03 × P). Otherwise that row becomes
   "ไม่มี strike ใกล้ <target>". The row always prints the strike's actual distance below P in %.
4. **Bid and spread are shown.** Each row shows bid and ask. The row is flagged "spread กว้าง" when
   bid is 0 / missing or (ask − bid) / ask > 0.30. Math still uses the ask.
5. **Gap history.** g is taken from the same candles as P, which come back from the
   project's own `fetchCandlesBatch`. If fewer than 60 sessions are usable (same floor as
   `GAP_MIN_SESSIONS`), the gap line says there is not enough history. No extra frozen-series check
   beyond what `fetchCandlesBatch` already does.
6. **Tickers with a dot (BRK.B):** no options found is the fail-soft answer.
7. **One card per open journal row**, even if two rows share a ticker; the quote fetch is shared.

## Open (does not block building)

- Whether the owner's broker (Webull / Pi) allows US options on their account. The card's footer
  covers it; it does not change what gets built.
