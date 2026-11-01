# Agent #3: chart stop on /advisor — design

Status: draft, 2026-11-01. Owner-designed in chat; marked items are the designer's calls.

## 1. Intent

Today `/advisor` gets a stop from the chart only when the owner arrives from the chart agent's
popup (`?stop=`). A ticker typed by hand, or opened from a plain `/scan` row, falls back to
1.5 × daily ATR, which does not look at the chart at all.

The owner wants **/advisor itself to find the stop from the chart, for any ticker**. They also want
**an AI to explain that stop**: what structure it sits under and how solid that structure looks.

This follows the same split as agents #1 and #2. **Code measures, the AI describes, the owner
decides.** The AI never moves the stop, never sizes, and never says the trade will work.

## 2. Goals

- Every `/advisor` card gets a structural stop from the 5-minute chart when one exists. It falls
  back in a fixed, disclosed order when none does.
- The card always says which source the stop came from.
- The ATR stop stays visible next to it, as a comparison line.
- A short Thai AI reading explains the chosen stop.
- Everything downstream of the stop already works for a non-ATR stop through `stopAtrMult`, since
  agent #2, and keeps doing so: sizing, R ladder, cost in R, gap risk, fill guard, base rate, and
  RAVEN's facts.

## 3. Non-goals and anti-goals

- **No new edge claim.** A swing low is a description, not odds. `ADVISOR_NO_EDGE_CLAIM` stands.
  The AI reading must not imply a win rate.
- **The AI reading never changes a number.** If the AI is down, the card is identical apart from
  the reading block.
- **No DB logging.** This agent produces no rows. Nothing here is scored later. It would be a
  separate decision if the owner ever wants that.
- **No short side.** The stop is always below entry.
- **No auto-run beyond what `/advisor` already does.** The card loads when the owner submits. The
  AI reading fires on mount, as RAVEN does.
- **Anti-goal: a stop that silently differs from what the card says.** Every fallback names its
  reason on the card.

## 4. The stop chain (owner's decisions)

The card takes the first source that yields a valid stop, meaning a positive stop strictly below
the card's final entry:

1. **Given stop.** This is `?stop=` or a stop typed in the form. It covers the chart agent's sweep
   stop and keeps today's behaviour.
2. **5-minute swing low.** This is the owner's pick: option 3 of the four offered.
3. **PDL.** This is the previous session's low, the owner's pick for "no swing low yet".
4. **1.5 × ATR(14) daily.** Today's stop, now the last resort.

When a source is skipped, the card says why. Examples:
- "ยังไม่มี swing low ในกราฟ 5 นาทีวันนี้ จึงใช้ PDL"
- "PDL อยู่เหนือราคาเข้า (เปิด gap ลง) จึงใช้ ATR"
- "ดึงกราฟ 5 นาทีไม่ได้: … จึงใช้ ATR"

`stopSource` widens from `"atr" | "chart"` to **four values**: given, swing, PDL, ATR. The builder
picks the names. Every consumer of `stopSource` must be updated:
- the card label
- the form
- RAVEN's facts sheet
- any `=== "chart"` checks

### 4.1 Swing low (designer's calls, all adjustable)

- **Bars.** Alpaca SIP 5-minute bars, the same fetch the chart agent uses:
  `fetchAlpacaCandlesBatch([ticker], "5d", "5m")`.
- **Finished bars only.** Drop every bar ending after now − `SIP_DELAY_MS`
  (`CHART_BAR_SECONDS` = 300). Never read a forming bar.
- **Which session.** The *reading session* is today's regular session (09:30–16:00 ET) if it has
  finished bars. Otherwise it is the latest earlier session with regular bars. That covers the
  owner opening /advisor in the Thai evening before the open, on weekends and on holidays.
  Session cutting reuses `splitSessions` / `etClock`.
- **Pivot.** A *pivot low* is a regular-session bar whose low is strictly lower than the lows of
  the 2 bars before it and the 2 bars after it, inside the reading session.
  - The last 2 bars of the session can never be pivots yet. That is intended.
  - Ties do not count, because the comparison is strict.
- **Choice.** Pick the **most recent** pivot whose low is below the card's entry.
- **Stop price.** Stop = pivot low − **0.1 × ATR**. The 0.1 matches the chart agent's
  `CHART_STOP_BUFFER_ATR`.
- **Which ATR.** The ATR is the card's own daily ATR14, so `stopAtrMult` and the buffer agree. This
  differs knowingly from the chart agent, whose ATR excludes today's forming daily bar.

### 4.2 PDL (owner's pick)

- PDL is the low of the session before the reading session, regular hours only.
- Stop = PDL − 0.1 × ATR, the same buffer as the swing low.
- If that stop is not below entry, the chain moves on to ATR. This is the gap-down case, and the
  card says so.

### 4.3 Flags (designer's calls)

These are labels only. **A flag never changes the stop.**

- **Tight stop.** If the stop distance is under **0.5 × ATR**, the tag reads
  "แคบมาก โดน noise ง่าย". When the owner was offered option 3, they were told it is tight. The
  gap-risk block already shows what an overnight gap does to a tight stop.
- **Wide stop.** If the stop distance is over **3 × ATR**, the tag reads "กว้างมาก หุ้นที่ซื้อได้จะน้อย".
  This mostly happens with PDL after a big up-day.

### 4.4 Comparison line

The card shows the **ATR stop beside the chosen one**: price, distance in ATR, and whole-share size
at that stop. It is shown only when the chosen source is not ATR. The comparison is informational,
and the card is still sized at the chosen stop.

### 4.5 Form (designer's calls)

- **The Stop field is always visible.** Today it shows only when `?stop=` prefilled it (around
  `advisor-form.tsx` line 195). Blank means "run the chain", and a number means a given stop. The
  placeholder says so.
- **Getting the ATR stop back.** The comparison line carries a button, "ใช้ stop ATR แทน", that
  fills the Stop field with the ATR stop price and resubmits. That card then reads source "given",
  which is honest, because the owner chose it. No new `stopMode` input is needed.

## 5. AI reading (owner asked for it)

- **When it runs.** One call per card, fired on mount, in its own block, the same pattern as
  `advisor-critique.tsx`.
  - It runs only for a **swing** or **PDL** stop: the two sources where code knows the structure bar.
  - For an ATR stop the block shows "stop นี้ไม่ได้มาจากโครงกราฟ จึงไม่มีอะไรให้อ่าน" and no call is
    made.
  - For a **given** stop no call is made either (designer's call). The note reads "stop นี้กำหนดมาเอง
    (จากป๊อปอัป agent กราฟหรือพิมพ์เอง) จึงไม่ได้ให้ AI อ่านซ้ำ". The reasons:
    - The chart agent already wrote a reading for its sweep stop.
    - A typed number has no structure bar that code can name.
    - Making the AI guess what a typed stop "sits under" is the guessing this design avoids.
- **What it gets.** The data is built in code; the AI receives facts, not a chart image:
  - the stop, its source and the structure bar (pivot or PDL)
  - the entry and the ATR
  - the distance in ATR and the flags
  - the last ~48 finished 5-minute bars of the reading session (designer's call; the chart agent
    uses 24)
  - PDL, PDH and the previous-session VAL/POC (reuse `computeLevels` where it fits)
- **What it says.** 2–4 Thai sentences on what the stop sits under and how clean that structure
  is, for example:
  - one touch or several
  - a deep wick or a shallow dip
  - whether another level sits just below
  - whether the pivot is only a few bars old
  
  It may add one short concern line, e.g. "pivot นี้เพิ่งเกิด 3 แท่ง โครงยังไม่ยืนยัน".
- **What it never says.** It is guarded like the chart agent: reuse `isDirectional` and
  `CHART_PREDICTION_PHRASES_TH`. A guarded reading is dropped and replaced with a note. It never
  carries:
  - a prediction or a probability
  - an entry or exit call
  - a recommended stop price
  - anything about whether to buy
- **It has no veto.** Unlike agent #2, there is nothing to veto: the stop stays whatever the code
  chose.
- **Backend.** It goes through the existing `src/lib/anthropic.ts` path (Claude CLI on the owner's
  plan, sonnet). If it is unavailable, it shows the same outage note as RAVEN and the chart agent.
  On Vercel it is always unavailable, by design.
- **Never throws.** The card above it is already complete.

## 6. Where things change (for orientation; the builder decides the exact split)

- `src/lib/advisor/`: a pure module that takes 5-minute bars, the entry, the ATR and a clock cutoff,
  and returns the chosen structural stop or the reason none was found. It gets unit tests like the
  rest of `src/lib/advisor/`. `advise()` takes its result as an input and stays pure.
- `src/app/api/advisor/route.ts`: one more fail-soft fetch, the 5-minute bars, joined to the
  existing `Promise.all`. A failure means the swing low and PDL are skipped with the reason, and
  the request never fails over it.
- A new AI module plus a route for the reading, mirroring `advisorCritic` and the critique route.
- `src/app/advisor/`:
  - the card label per source
  - the skip reason
  - the flags
  - the ATR comparison line
  - the reading block
- `docs/STATE.md` gets an entry when it ships.

## 7. Open, not blocking

- **The owner has not said whether they hold overnight.** The design always shows the gap-risk
  block, which already exists, so it does not depend on the answer.
- **The two flag thresholds, 0.5 and 3 × ATR, are guesses.** They are easy to change later.
