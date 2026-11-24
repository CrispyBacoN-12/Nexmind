import { test } from "node:test";
import assert from "node:assert/strict";

import { worstGapDownPct } from "./gaps";

test("worstGapDownPct: needs 60 measurable sessions", () => {
  const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1 }));
  const b = bars(61);
  b[30] = { ...b[30], o: 88 };
  assert.ok(Math.abs(worstGapDownPct(b)! - 0.12) < 1e-9);
  assert.equal(worstGapDownPct(bars(60)), null);
  assert.equal(worstGapDownPct(null), null);
});
