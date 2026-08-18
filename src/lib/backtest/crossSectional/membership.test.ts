import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMembershipCsv, buildMembershipIndex } from "./membership";
import { dayKey } from "./calendar";

// Real add/drop pattern pulled from fja05680/sp500's "S&P 500 Historical
// Components & Changes (Updated).csv" (verified by direct fetch): TSLA joins
// 2020-12-21; ATVI's last appearance is 2023-10-02, first confirmed absence
// 2023-10-18. Rows are trimmed to a handful of tickers each; only the dates
// and the add/drop shape are load-bearing.
const FIXTURE_CSV = `date,tickers
1996-01-02,"AAPL,ABT,AAL"
2020-12-04,"AAPL,ABT,MSFT"
2020-12-21,"AAPL,ABT,MSFT,TSLA"
2023-10-02,"AAPL,ABT,MSFT,TSLA,ATVI"
2023-10-18,"AAPL,ABT,MSFT,TSLA"
`;

function dayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return dayKey(Date.UTC(y, m - 1, d) / 1000);
}

test("parseMembershipCsv reads one snapshot per row, skipping the header", () => {
  const snapshots = parseMembershipCsv(FIXTURE_CSV);
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].day, dayOf("1996-01-02"));
  assert.deepEqual([...snapshots[0].members].sort(), ["AAL", "AAPL", "ABT"]);
});

test("parseMembershipCsv strips the quotes around the ticker list", () => {
  const snapshots = parseMembershipCsv(FIXTURE_CSV);
  for (const s of snapshots) for (const m of s.members) assert.ok(!m.includes('"'));
});

test("buildMembershipIndex: TSLA is not a member before it joined", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("TSLA", dayOf("2020-12-04")), false);
  assert.equal(isMember("TSLA", dayOf("2020-12-21")), true);
});

test("buildMembershipIndex: ATVI stops being a member on its removal snapshot", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("ATVI", dayOf("2023-10-02")), true);
  assert.equal(isMember("ATVI", dayOf("2023-10-18")), false);
  // A day strictly between two snapshots uses the LATEST snapshot <= that day.
  assert.equal(isMember("ATVI", dayOf("2023-10-02") + 5), true);
});

test("buildMembershipIndex: a day before the first snapshot has no members", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("AAPL", dayOf("1996-01-02") - 1), false);
});

test("buildMembershipIndex: a day after the last snapshot uses the latest snapshot (today's behaviour)", () => {
  const isMember = buildMembershipIndex(parseMembershipCsv(FIXTURE_CSV));
  assert.equal(isMember("TSLA", dayOf("2023-10-18") + 1000), true);
  assert.equal(isMember("ATVI", dayOf("2023-10-18") + 1000), false);
});

test("buildMembershipIndex sorts out-of-order input snapshots before querying", () => {
  const shuffled = [...parseMembershipCsv(FIXTURE_CSV)].reverse();
  const isMember = buildMembershipIndex(shuffled);
  assert.equal(isMember("TSLA", dayOf("2020-12-21")), true);
  assert.equal(isMember("TSLA", dayOf("2020-12-04")), false);
});
