import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filingWatch,
  filingWindowStart,
  FILING_WATCH_FIRST_RUN_DAYS,
  FILING_WATCH_MAX_LOOKBACK_DAYS,
  type FilingRow,
} from "./filingWatch";

const SINCE = new Date("2026-10-27T12:00:00Z");
const UNTIL = new Date("2026-10-30T12:00:00Z");

const row = (over: Partial<FilingRow> = {}): FilingRow => ({
  form: "8-K",
  items: ["4.02"],
  acceptedAt: "2026-10-29T20:05:00.000Z",
  url: "https://www.sec.gov/x",
  ...over,
});

test("a restatement inside the window is a red hit", () => {
  const r = filingWatch([{ ticker: "KO", result: { filings: [row()] } }], SINCE, UNTIL);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].tier, "red");
  assert.equal(r.hits[0].items[0].code, "4.02");
});

test("routine items alone never alert", () => {
  const r = filingWatch(
    [{ ticker: "KO", result: { filings: [row({ items: ["2.02", "9.01"] }), row({ items: ["5.07"] }), row({ items: ["7.01"] })] } }],
    SINCE,
    UNTIL,
  );
  assert.deepEqual(r.hits, []);
});

test("quiet items are stripped from a hit and red sorts before notable", () => {
  const r = filingWatch([{ ticker: "KO", result: { filings: [row({ items: ["5.02", "9.01", "1.05"] })] } }], SINCE, UNTIL);
  assert.deepEqual(r.hits[0].items.map((i) => i.code), ["1.05", "5.02"]);
  assert.equal(r.hits[0].tier, "red");
});

test("the window is (since, until] — boundaries and outside are excluded", () => {
  const r = filingWatch(
    [
      {
        ticker: "KO",
        result: {
          filings: [
            row({ acceptedAt: SINCE.toISOString() }), // exactly since: last run already covered it
            row({ acceptedAt: "2026-10-20T00:00:00.000Z" }),
            row({ acceptedAt: "2026-10-30T12:00:01.000Z" }), // after this run started: next run's
            row({ acceptedAt: UNTIL.toISOString(), items: ["5.02"] }),
          ],
        },
      },
    ],
    SINCE,
    UNTIL,
  );
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].items[0].code, "5.02");
});

test("8-K/A counts, other forms do not", () => {
  const r = filingWatch(
    [{ ticker: "KO", result: { filings: [row({ form: "8-K/A" }), row({ form: "10-Q" }), row({ form: "4" })] } }],
    SINCE,
    UNTIL,
  );
  assert.deepEqual(r.hits.map((h) => h.form), ["8-K/A"]);
});

test("an unknown item code is shown as notable rather than dropped", () => {
  const r = filingWatch([{ ticker: "KO", result: { filings: [row({ items: ["6.03"] })] } }], SINCE, UNTIL);
  assert.equal(r.hits[0].tier, "notable");
  assert.equal(r.hits[0].items[0].label, "unrecognised item");
});

test("a failed fetch is reported as unchecked, a fund as no filer", () => {
  const r = filingWatch(
    [
      { ticker: "AAPL", result: { error: "sec 503" } },
      { ticker: "SPY", result: { noFiler: true } },
    ],
    SINCE,
    UNTIL,
  );
  assert.deepEqual(r.failed, [{ ticker: "AAPL", reason: "sec 503" }]);
  assert.deepEqual(r.noFiler, ["SPY"]);
  assert.deepEqual(r.hits, []);
});

test("hits are ordered red first across tickers", () => {
  const r = filingWatch(
    [
      { ticker: "AAA", result: { filings: [row({ items: ["5.02"], acceptedAt: "2026-10-28T00:00:00.000Z" })] } },
      { ticker: "BBB", result: { filings: [row({ items: ["4.01"], acceptedAt: "2026-10-29T00:00:00.000Z" })] } },
    ],
    SINCE,
    UNTIL,
  );
  assert.deepEqual(r.hits.map((h) => h.ticker), ["BBB", "AAA"]);
});

const NOW = new Date("2026-10-30T12:00:00Z");
const DAY = 86_400_000;

test("first run looks back the first-run window", () => {
  assert.equal(filingWindowStart(null, NOW).getTime(), NOW.getTime() - FILING_WATCH_FIRST_RUN_DAYS * DAY);
  assert.equal(filingWindowStart("garbage", NOW).getTime(), NOW.getTime() - FILING_WATCH_FIRST_RUN_DAYS * DAY);
});

test("a stored window end is resumed from, but never further back than the cap", () => {
  assert.equal(filingWindowStart("2026-10-29T12:00:00.000Z", NOW).toISOString(), "2026-10-29T12:00:00.000Z");
  assert.equal(
    filingWindowStart("2026-01-01T00:00:00.000Z", NOW).getTime(),
    NOW.getTime() - FILING_WATCH_MAX_LOOKBACK_DAYS * DAY,
  );
});

test("a stored window end in the future is treated as unreadable", () => {
  assert.equal(
    filingWindowStart("2027-01-01T00:00:00.000Z", NOW).getTime(),
    NOW.getTime() - FILING_WATCH_FIRST_RUN_DAYS * DAY,
  );
});
