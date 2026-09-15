import { test } from "node:test";
import assert from "node:assert/strict";
import { earningsWatchdog, EARNINGS_WATCHDOG_DAYS } from "./earningsWatchdog";

const TODAY = new Date("2026-09-16T12:00:00Z");
const MS_PER_DAY = 86_400_000;

test("a holding inside the window is flagged", () => {
  const hits = earningsWatchdog(
    [{ ticker: "AAPL", earnings: { date: "2026-09-18", hour: "amc" } }],
    TODAY,
  );
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { ticker: "AAPL", date: "2026-09-18", hour: "amc", daysAway: 2 });
});

test("a holding outside the window is not flagged", () => {
  const hits = earningsWatchdog(
    [{ ticker: "MSFT", earnings: { date: "2026-09-25", hour: null } }],
    TODAY,
  );
  assert.equal(hits.length, 0);
});

test("a null-date EarningsInfo is never flagged, whatever the reason", () => {
  const hits = earningsWatchdog(
    [
      { ticker: "NVDA", earnings: { date: null, hour: null, note: "no report scheduled in the next 120 days" } },
      { ticker: "TSLA", earnings: { date: null, hour: null, note: "FINNHUB_API_KEY not set" } },
    ],
    TODAY,
  );
  assert.equal(hits.length, 0);
});

test("the boundary day itself is included", () => {
  const boundaryDate = new Date(TODAY.getTime() + EARNINGS_WATCHDOG_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const hits = earningsWatchdog([{ ticker: "KO", earnings: { date: boundaryDate, hour: "bmo" } }], TODAY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].daysAway, EARNINGS_WATCHDOG_DAYS);
});

test("a report today (daysAway 0) is included, not treated as already past", () => {
  const hits = earningsWatchdog([{ ticker: "KO", earnings: { date: "2026-09-16", hour: "bmo" } }], TODAY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].daysAway, 0);
});
