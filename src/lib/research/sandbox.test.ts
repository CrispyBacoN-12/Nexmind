import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStrategy, scanForUnsafeConstructs, SandboxSafetyError } from "./sandbox";
import type { Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";

const HOUR = 3600;

function bar(t: number, c: number): Candle {
  return { t, o: c, h: c + 1, l: c - 1, c, v: 1000 };
}

function makeBarsAndSnaps(n: number): { bars: Candle[]; snaps: ScanSnapshot[] } {
  const bars = Array.from({ length: n }, (_, i) => bar(i * HOUR, 100 + i));
  const snaps: ScanSnapshot[] = bars.map((b) => ({
    price: b.c, sma20: b.c, sma50: b.c, rsi: 50, adx: 30, plusDI: 20, minusDI: 10, macdHist: 0, atr: 1,
  }));
  return { bars, snaps };
}

test("safe code executes and returns a signal", () => {
  const { bars, snaps } = makeBarsAndSnaps(5);
  const strat = compileStrategy(`
    var i = bars.length - 1;
    if (snaps[i].rsi > 40) return { side: "long", note: "ok" };
    return null;
  `);
  const result = strat.invoke(bars, snaps, 4);
  assert.deepEqual(result, { side: "long", note: "ok" });
});

test("deny-listed code is rejected before execution", () => {
  assert.throws(() => compileStrategy("return process.env.SECRET;"), SandboxSafetyError);
  assert.throws(() => compileStrategy("require('fs'); return null;"), SandboxSafetyError);
  const flagged = scanForUnsafeConstructs("const x = globalThis; return null;");
  assert.ok(flagged.length > 0);
});

test("an infinite loop is killed by the sandbox timeout, not hung forever", () => {
  const { bars, snaps } = makeBarsAndSnaps(2);
  const strat = compileStrategy("while (true) {} return null;");
  const start = Date.now();
  const result = strat.invoke(bars, snaps, 1);
  const elapsed = Date.now() - start;
  assert.equal(result, null); // failed open — no signal, not a crash
  assert.ok(elapsed < 2000, `expected the vm timeout to bound execution, took ${elapsed}ms`);
});

test("mutation attempts on frozen bars/snaps don't corrupt shared state across invocations", () => {
  const { bars, snaps } = makeBarsAndSnaps(5);
  const strat = compileStrategy(`
    bars[0].c = -999;
    snaps[0].rsi = -999;
    var i = bars.length - 1;
    return { side: "long", note: "c0=" + bars[0].c };
  `);
  strat.invoke(bars, snaps, 4);
  assert.equal(bars[0].c, 100); // unchanged — frozen, mutation silently no-ops
  assert.equal(snaps[0].rsi, 50);
  // a later invocation sees the same untouched history
  const result = strat.invoke(bars, snaps, 4);
  assert.equal(result?.note, "c0=100");
});

test("lookahead is structurally prevented — index i is always the last element", () => {
  const { bars, snaps } = makeBarsAndSnaps(10);
  const strat = compileStrategy(`
    if (bars.length - 1 !== snaps.length - 1) return { side: "short", note: "mismatch" };
    if (bars[bars.length - 1].c !== ${bars[3].c}) return null;
    return { side: "long", note: "saw only up to i=3" };
  `);
  const result = strat.invoke(bars, snaps, 3);
  assert.deepEqual(result, { side: "long", note: "saw only up to i=3" });
});
