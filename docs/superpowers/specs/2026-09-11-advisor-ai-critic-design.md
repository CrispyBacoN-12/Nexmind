# RAVEN — an AI critic for the stock advisor that can only object

**Date:** 2026-09-11
**Status:** design approved, ready for an implementation plan
**Scope:** the STOCKS half only. Nothing here touches gold/MT5, the desk engine,
HAWK, SAGE, or any research script.
**Builds on:** `docs/superpowers/specs/2026-09-10-stock-advisory-tool-design.md`

## 0. Why this exists, and the one thing it must never become

The advisory tool is pure arithmetic. It reports structure and risk for a ticker
the owner already chose, and every card carries `ADVISOR_NO_EDGE_CLAIM`
verbatim. The owner asked what an AI could add to it.

The project already has the answer in its own record, and it is narrow:

- **HAWK — a directional vote — has produced nothing here.** 51 `Counterfactual`
  rows, all `aiBackend = "cli"`, **0 fills**; no-consensus dominates. A vote
  bolted onto `/advisor` would print "skip" at the owner all day and add no
  information.
- **SAGE — an independent reviewer that may only object — produced real
  arguments.** On 2026-09-02, after the two live defects were fixed, all six of
  SAGE's vetoes were genuine structural objections: COP sitting 26.7% above its
  SMA50, MDLZ's TP1 requiring a range high the name has never printed.
- **§5 of the advisory spec stands: live trading cannot measure an edge.** Five
  slots weekly is 15-25 closed trades in eight weeks, SE ±0.31R against a
  ~0.04R effect. So the AI's value must not depend on a measured edge — which a
  directional vote's value entirely does, and an objection's does not.

**The load-bearing constraint:** RAVEN can only argue against. It never says
buy, never says skip, never ranks, never scores, never approves. Saying what to
do is an edge claim, and this project has none to make. The type contract and a
deterministic guard both enforce this — the prompt alone is not trusted with it.

RAVEN is decoration on a card that is already complete. If it is slow, broken,
or absent, the card is unchanged and still correct.

## 1. What RAVEN is shown, and what it returns

### 1.1 Inputs

Everything RAVEN sees was produced by this server one request earlier:

- the `AdvisorCard` (entry, stop, ATR, R ladder, sizing and its `boundBy`,
  correlations, `corrMultiplier`, `freeSlots`, `gate`, `warnings`)
- the `ChartRow[]` already returned alongside it — two years of daily bars with
  SMA50 and SMA200

No new market-data pull, no recomputation. The numbers RAVEN argues about are
byte-for-byte the numbers on the owner's screen. `buildAnalystContext` is **not**
reused: it takes a `ScanResult`, which the advisor never produces. The advisor
gets its own, much smaller renderer.

### 1.2 Output

```ts
export type Severity = "note" | "concern" | "serious";

export interface Objection {
  /** What is wrong with this structure. One sentence. */
  claim: string;
  /** The number from the card or the facts sheet that supports the claim. */
  evidence: string;
  severity: Severity;
}

export interface CritiqueResult {
  /** 0-4. Zero is a legitimate answer and is rendered as such. */
  objections: Objection[];
  /** What the card cannot see at all: earnings dates, news, sector-wide moves. */
  blindSpots: string[];
  /** True when the AI backend was unavailable or the call failed. Objections is
   *  then empty and `note` says why. Never throws at the route. */
  degraded: boolean;
  note: string;
  /** Claims the guard stripped, verbatim, so a muzzled model is visible. */
  stripped: string[];
  model: string;
  costUsd: number;
}
```

There is deliberately no `approved`, no `score`, no `side`, no `confidence`.
`SageVerdict` has `approved: boolean` because SAGE gates a real order; RAVEN
gates nothing, so the field would only invite a reader to treat it as a verdict.

## 2. Files

| File | Responsibility | Pure |
|---|---|---|
| `src/lib/advisor/critiqueContext.ts` | `AdvisorCard` + `ChartRow[]` to facts sheet string; `guardObjections()` | **yes** |
| `src/lib/advisor/critiqueContext.test.ts` | facts-sheet content, guard behaviour, degenerate cards | — |
| `src/lib/critic/advisorCritic.ts` | system prompt, JSON schema, `callAgentJSON`, fallback | no (I/O) |
| `src/lib/critic/advisorCritic.test.ts` | mock-backend path returns `degraded`, never throws | — |
| `src/app/api/advisor/critique/route.ts` | POST boundary: validate body, call, return | no (I/O) |
| `src/app/advisor/advisor-critique.tsx` | the button, the loading state, the rendered objections | no |

`src/lib/advisor/` stays pure — the rule from the advisory spec is unchanged.
The AI call therefore cannot live there; it goes in a sibling `src/lib/critic/`,
mirroring how `src/lib/trading/sage.ts` sits beside the pure modules it reads.

Nothing in `advise.ts`, `sizing.ts`, `rLadder.ts`, `chartSeries.ts` or
`types.ts` is modified. `AdvisorCard` keeps meaning exactly what it meant before
RAVEN existed, the way `chart` rides alongside it rather than inside it.

## 3. The facts sheet (pure)

`renderCritiqueContext(card, chart)` returns one string in named blocks, so
blocks can be added later without re-deriving anything:

- **head** — ticker, `asOf`, last close, entry and `entrySource`, `alreadyHeld`
- **risk** — ATR and ATR as a percent of price, `slDistance`, stop, `costR`
- **sizing** — shares, `boundBy`, `slotBudget`, `riskUsdTarget` vs
  `actualRiskUsd` and `actualRiskPct`, `deployedUsd`, and the sizing `reason`
  verbatim (it is the one field that explains a zero)
- **ladder** — each `LadderRow` as `r · price · gainPct · plUsd`
- **portfolio** — `correlations` with their notes, `avgCorrelation`,
  `corrMultiplier` and `corrAdjustedShares` **labelled as reported, not
  applied**, `freeSlots`
- **regime** — the `GateDecision` as it is printed on the card
- **position in range** — from `chart`: distance from SMA50 and SMA200 as
  percentages, the 52-week high and low and where the last close sits between
  them, and the highest high and lowest low of the last 20 bars. This is the
  block that lets RAVEN make the COP-style "26.7% above its SMA50" argument and
  the MDLZ-style "that target is above anything this name has printed" argument.
- **warnings** — the card's own `warnings`, verbatim

Every number is formatted once, here. A null or missing input renders as an
explicit `n/a` line, never as a silently dropped fact — an absent line reads to
the model as a fact that does not exist.

## 4. The guard (pure, and the reason the no-edge claim survives)

`guardObjections(objections)` runs on the model's output before anything is
returned to the browser. An objection whose `claim` or `evidence` matches
directional or recommendation language — case-insensitive, word-boundary
matched — is **removed**, and its text is appended verbatim to `stripped`.

The vocabulary, exactly:

```
English (word-boundary, case-insensitive):
  buy, buying, sell, selling, long, short, enter, entering, avoid,
  recommend, recommendation, suggest, should, worth it, take this trade
Thai (substring — Thai has no word boundaries):
  ควรซื้อ, น่าซื้อ, ควรเข้า, น่าเข้า, ควรขาย, ไม่ควร, แนะนำ, น่าลงทุน
```

Thai matches are plain substring tests: Thai is written without spaces, so a
`\b` anchor never fires and would silently disable the entire Thai half of the
list.

Two properties this must have, and both are tested:

1. Stripping is **visible**, never silent. A model that has to be muzzled is
   information about the model, and `stripped` is rendered in the UI.
2. Negated forms are stripped too. "You should not buy this" is still a verdict.
   The guard does not attempt sentiment analysis; presence of the vocabulary is
   the test, and a false strip costs one objection, which is cheap.

The prompt also forbids this language. The guard exists because a prompt is not
an enforcement mechanism, and `ADVISOR_NO_EDGE_CLAIM` is printed on the same
screen.

## 5. The AI call

`critiqueCard(facts: string): Promise<CritiqueResult>` in
`src/lib/critic/advisorCritic.ts`.

**System prompt, in substance:** You are RAVEN, an independent critic on a
trading desk. You are shown a structure-and-risk card for a stock the owner
already chose. Your only job is to name what is *wrong* with the structure and
what the card cannot see. You never say whether to take the trade, because
neither you nor this desk has any measured edge. Return at most four objections,
each with the specific number that supports it. Returning zero objections is a
valid and useful answer; do not invent one to fill space.

**Tier:** `sonnet`. This is judgment work; a cheaper tier produces the generic
objections that made HAWK's votes worthless.

**Backend:** whatever `aiBackend()` resolves to. Today that is `"cli"` —
`.env` carries `ANTHROPIC_API_KEY=` with an empty value, so `callAgent` takes
the `callAgentCli` path at `src/lib/anthropic.ts:310`, spawning
`claude -p --output-format json --model sonnet` against the owner's
**subscription**, and reporting `costUsd: 0` ("Subscription auth: the reported
figure is informational, not billed"). This matches the desk: all 51
`Counterfactual` rows recorded `aiBackend = "cli"`.

**Consequences of the CLI backend, which the UI must respect:**

- It spawns a subprocess and serialises behind `cliAcquire()`. A realistic
  round trip is **10-40 seconds**, with a hard 240s timeout.
- `costUsd` is `0` and is displayed as "subscription", not as "$0.00" — a
  printed zero dollars reads as a bug.

**Failure is never an exception at the boundary.** `AiUnavailableError`, a CLI
timeout, malformed JSON and a schema mismatch all resolve to
`{ degraded: true, objections: [], note: <reason>, ... }`. `aiOutageReason()`
supplies the note when the backend is simply not configured.

## 6. The route

`POST /api/advisor/critique`, body `{ card, chart }`.

Validation rejects a body missing `card.ticker`, `card.entry`, `card.stop`,
`card.sizing` or `card.ladder` with a 400 and a plain-text reason. The payload
is server-produced data making a round trip through the browser; a mangled body
yields a nonsense critique, and since nothing is persisted, sized, or traded on,
a shape check is the proportionate defence. `chart` may be `null` — the
position-in-range block then renders `n/a` and RAVEN loses one class of
argument, not the response.

`GET` is not implemented. Nothing is written to the database in this version:
persistence belongs to the decision-journal work, which is a separate design.

## 7. The UI

Under the card, below the ladder and above the no-edge claim:

- A button, **"หาข้อโต้แย้ง"**, disabled while in flight, with its own visible
  progress state and honest copy about the wait ("อาจใช้เวลา 10-40 วินาที").
- Objections render newest-request-only, each as severity chip + claim +
  evidence. `serious` is not styled as an alarm; it is a stronger argument, not
  a signal.
- **Zero objections renders as a sentence, not as blank space:** "RAVEN ไม่พบ
  ข้อโต้แย้งจากตัวเลขชุดนี้ — ไม่ได้แปลว่าน่าเข้า" The second clause is not
  optional. An empty result is the single most likely thing to be misread as
  approval.
- `blindSpots` render in a separate, quieter block.
- `stripped` renders in a small note: "RAVEN พยายามให้คำแนะนำซื้อ/ขาย N ครั้ง —
  ตัดออกแล้ว" with the text available. A muzzled model is a fact about the
  model.
- `degraded` renders the reason inline. The card above it is untouched.
- Changing any form input clears an existing critique: an objection about a
  $340 entry must not sit under a card that now says $326.

## 8. Testing

Under `src/lib/`, per the project's convention that `src/app/` carries no tests.

`critiqueContext.test.ts`:
- the facts sheet contains entry, stop, ATR, `costR` and every ladder rung
- `shares: 0` still renders, and carries the sizing `reason` verbatim
- `chart: null` renders the position-in-range block as `n/a` and throws nothing
- `corrMultiplier` is labelled reported-not-applied in the rendered text
- the guard strips the directional vocabulary, records it in `stripped`, strips
  the negated form "should not buy", and leaves a clean structural objection
  untouched

`advisorCritic.test.ts`:
- with the backend resolving to `"mock"`, returns `degraded: true`,
  `objections: []`, a non-empty `note`, and does not throw
- a response whose objections are all directional comes back with
  `objections: []` and a populated `stripped` — the guard runs inside
  `critiqueCard`, not only in the UI

No network in any test.

## 9. Explicitly out of scope

- Any directional opinion, score, ranking, or approval flag (§0)
- Persisting critiques, or the decision journal that would read them back
- Automatic invocation on submit — the wait (§5) and the subscription's serial
  queue both argue against it, and the card must render before any AI runs
- Touching the desk's HAWK/SAGE path, the research scripts, or gold/MT5
