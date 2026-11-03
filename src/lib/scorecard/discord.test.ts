import test from "node:test";
import assert from "node:assert/strict";
import { isChartPrediction } from "@/lib/chartAgent/review";
import { buildDiscordMessage, type DiscordInput } from "./discord";
import type { LastRunSummary, LiveSnapshot } from "./nightly";

const emptyStats = { n: 0, meanR: null, winPct: null, t1Pct: null };

function lastRun(over: Partial<LastRunSummary> = {}): LastRunSummary {
  return {
    sessionDate: "2026-11-03",
    status: "ran",
    ranAt: "2026-11-03T15:31:00.000Z", // 22:31 ICT
    error: null,
    setups: 4,
    kept: 2,
    vetoed: 1,
    stripped: 0,
    unread: 1,
    aiDown: false,
    ...over,
  };
}

function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const variants = { hold: emptyStats, sameDay: emptyStats };
  return {
    ruleVersion: "sweep-v1",
    computedAt: "2026-11-04T00:00:00.000Z",
    sessionDate: "2026-11-03",
    stats: { kept: variants, vetoed: variants, stripped: variants, unread: variants, afterVerdict: variants },
    counts: {} as LiveSnapshot["counts"],
    keptControl: null,
    keptProgress: { n: 12, closed: 8, meanR: 0.153, target: 300 },
    modelMix: { "claude-sonnet-a": 12 },
    cumulativeR: { kept: [], vetoed: [], stripped: [], unread: [], afterVerdict: [] },
    missed: [],
    lastRun: lastRun(),
    recentTrades: [],
    verdict: null,
    verdictPending: null,
    ...over,
  };
}

function input(over: Partial<DiscordInput> = {}): DiscordInput {
  const snap = over.snapshot ?? snapshot();
  return {
    snapshot: snap,
    lastRun: snap.lastRun,
    sessionDate: snap.sessionDate,
    closedOvernight: [
      { ticker: "AAPL", group: "kept", r: 1.2, reason: "t1" },
      { ticker: "MSFT", group: "vetoed", r: -1.004, reason: "stop" },
      { ticker: "WDC", group: "kept", r: -0.1, reason: "time" },
    ],
    openNow: [{ ticker: "NVDA", group: "kept", sessionsHeld: 3 }],
    ...over,
  };
}

test("the lines come in the fixed order", () => {
  const lines = buildDiscordMessage(input()).split("\n");
  assert.equal(lines[0], "NEXMIND Scorecard — 2026-11-03");
  assert.match(lines[1], /AI เก็บ 2/);
  assert.match(lines[1], /AI ตัดทิ้ง 1/);
  assert.match(lines[2], /^ปิดแล้ว: AAPL \+1\.20R/);
  assert.match(lines[2], /MSFT -1\.00R/);
  assert.match(lines[3], /^ยังถือ: NVDA 3\/10/);
  // 8 closed < SCORECARD_MIN_N: no mean is printed.
  assert.equal(lines[4], "สะสม AI เก็บ: 12/300 · ปิดแล้ว 8 · เฉลี่ย ยังน้อยเกินไป");
  assert.equal(lines[5], "ซื้อสุ่ม: คำนวณตอนครบ 300"); // no live control before the verdict
  assert.equal(lines[6], "สถานะ: ยังตัดสินไม่ได้");
  assert.equal(lines[7], "รอบอัตโนมัติเมื่อคืน: รันแล้ว 22:31");
  assert.equal(lines.length, 8);
});

test("the kept line prints the mean of closed rows only once SCORECARD_MIN_N have closed", () => {
  const line = (closed: number) =>
    buildDiscordMessage(input({ snapshot: snapshot({ keptProgress: { n: 40, closed, meanR: 0.153, target: 300 } }) })).split("\n")[4];
  assert.equal(line(29), "สะสม AI เก็บ: 40/300 · ปิดแล้ว 29 · เฉลี่ย ยังน้อยเกินไป");
  assert.equal(line(30), "สะสม AI เก็บ: 40/300 · ปิดแล้ว 30 · เฉลี่ย 0.15R");
});

test("says the AI was down", () => {
  const snap = snapshot({ lastRun: lastRun({ kept: 0, vetoed: 0, unread: 3, setups: 3, aiDown: true }) });
  const msg = buildDiscordMessage(input({ snapshot: snap, lastRun: snap.lastRun }));
  assert.ok(msg.includes("⚠️ AI ไม่ทำงานเมื่อคืน — setup ไม่นับเข้า 300"));
  assert.ok(!buildDiscordMessage(input()).includes("AI ไม่ทำงาน"));
});

test("says the run was missed", () => {
  const none = lastRun({ status: "none", ranAt: null, setups: 0, kept: 0, vetoed: 0, unread: 0 });
  assert.ok(buildDiscordMessage(input({ lastRun: none })).includes("รอบอัตโนมัติเมื่อคืน: ไม่ได้รัน (คอมปิด?)"));
  const holiday = lastRun({ status: "no_session", setups: 0, kept: 0, vetoed: 0, unread: 0 });
  assert.ok(buildDiscordMessage(input({ lastRun: holiday })).includes("รอบอัตโนมัติเมื่อคืน: ไม่มีตลาด"));
  const failed = lastRun({ status: "failed", error: "scan พัง", setups: 0, kept: 0, vetoed: 0, unread: 0 });
  assert.ok(buildDiscordMessage(input({ lastRun: failed })).includes("รอบอัตโนมัติเมื่อคืน: ล้มเหลว: scan พัง"));
});

test("a frozen verdict decides the status line", () => {
  const verdict = {
    ruleVersion: "sweep-v1",
    n: 300,
    meanR: 0.3,
    controlMedian: 0,
    controlP95: 0.1,
    runs: 200,
    pass: true,
    computedAt: "2027-06-01T00:00:00.000Z",
    firstId: 1,
    lastId: 400,
    modelMix: {},
  };
  const pass = buildDiscordMessage(input({ snapshot: snapshot({ verdict }) }));
  assert.ok(pass.includes("ซื้อสุ่ม p95: 0.10R → ชนะ"));
  assert.ok(pass.includes("สถานะ: เชื่อได้"));
  // The frozen sample is all closed: n closed = the verdict's n.
  assert.ok(pass.includes("สะสม AI เก็บ: 300/300 · ปิดแล้ว 300 · เฉลี่ย 0.30R"));
  const fail = buildDiscordMessage(input({ snapshot: snapshot({ verdict: { ...verdict, pass: false } }) }));
  assert.ok(fail.includes("สถานะ: เชื่อไม่ได้"));
  assert.ok(fail.includes("ซื้อสุ่ม p95: 0.10R → ไม่ชนะ"));
  assert.ok(!fail.includes("ยังไม่ชนะ"));
});

test("contains no prediction phrase", () => {
  const verdict = { ruleVersion: "v", n: 300, meanR: 0.3, controlMedian: 0, controlP95: 0.1, runs: 200, pass: true, computedAt: "x", firstId: 1, lastId: 2, modelMix: {} };
  const variants = [
    input(),
    input({ snapshot: snapshot({ verdict }) }),
    input({ snapshot: snapshot({ verdict: { ...verdict, pass: false } }) }),
    input({ lastRun: lastRun({ kept: 0, unread: 2, aiDown: true }) }),
    input({ lastRun: lastRun({ status: "none", ranAt: null }), closedOvernight: [], openNow: [] }),
    input({ snapshot: snapshot({ keptProgress: { n: 0, closed: 0, meanR: null, target: 300 } }) }),
    input({ snapshot: snapshot({ keptProgress: { n: 40, closed: 35, meanR: 0.2, target: 300 } }) }),
    input({ snapshot: snapshot({ verdict, keptControl: { median: 0, p95: 0.1, runs: 200 } }) }),
  ];
  for (const v of variants) {
    const msg = buildDiscordMessage(v);
    assert.equal(isChartPrediction(msg), false, msg);
  }
});

test("after the verdict a caveat line follows the status line, and the message still passes the prediction guard", () => {
  const verdict = { ruleVersion: "v", n: 300, meanR: 0.3, controlMedian: 0, controlP95: 0.1, runs: 200, pass: true, computedAt: "x", firstId: 1, lastId: 2, modelMix: {} };
  const lineAfterStatus = (msg: string) => {
    const lines = msg.split("\n");
    return lines[lines.findIndex((l) => l.startsWith("สถานะ: ")) + 1];
  };

  const pass = buildDiscordMessage(input({ snapshot: snapshot({ verdict }) }));
  assert.equal(lineAfterStatus(pass), "ชนะ p95 ของการซื้อสุ่ม — ไม่ได้พิสูจน์ว่ามี edge");
  assert.equal(isChartPrediction(pass), false, pass);

  const fail = buildDiscordMessage(input({ snapshot: snapshot({ verdict: { ...verdict, pass: false } }) }));
  assert.equal(lineAfterStatus(fail), "ไม่ชนะ p95 ของการซื้อสุ่ม");
  assert.ok(!fail.includes("ไม่ได้พิสูจน์"));
  assert.equal(isChartPrediction(fail), false, fail);

  // Before the verdict there is no caveat line.
  assert.ok(!buildDiscordMessage(input()).includes("p95 ของการซื้อสุ่ม"));
  // The page's wording could not be used: "รับประกัน" is a CHART_PREDICTION_PHRASES_TH phrase.
  assert.equal(isChartPrediction("ชนะ p95 ของการซื้อสุ่ม ไม่ใช่การรับประกันว่ามี edge"), true);
});
