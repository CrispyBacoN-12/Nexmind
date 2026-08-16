import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, shuffle } from "./rng";

test("the same seed reproduces the same stream", () => {
  // A permutation p-value that cannot be reproduced from its seed is not
  // evidence, so determinism here is load-bearing, not a nicety.
  const a = Array.from({ length: 10 }, mulberry32(42));
  const b = Array.from({ length: 10 }, mulberry32(42));
  assert.deepEqual(a, b);
});

test("different seeds produce different streams", () => {
  const a = Array.from({ length: 10 }, mulberry32(42));
  const b = Array.from({ length: 10 }, mulberry32(43));
  assert.notDeepEqual(a, b);
});

test("draws stay inside [0, 1)", () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 5_000; i++) {
    const x = rand();
    assert.ok(x >= 0 && x < 1, `draw out of range: ${x}`);
  }
});

test("the same seed reproduces the same shuffle", () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = shuffle([...source], mulberry32(99));
  const b = shuffle([...source], mulberry32(99));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, source); // vacuity guard: it must actually permute
});

test("shuffle is a permutation — nothing lost, nothing duplicated", () => {
  const source = Array.from({ length: 200 }, (_, i) => i);
  const out = shuffle([...source], mulberry32(3));
  assert.deepEqual([...out].sort((x, y) => x - y), source);
});

test("shuffle reaches the first element", () => {
  // A Fisher-Yates written with `i > 0` but drawing from `i` instead of `i + 1`
  // never moves anything into the last slot. Sampling many seeds pins that down.
  const seen = new Set<number>();
  for (let seed = 0; seed < 200; seed++) seen.add(shuffle([0, 1, 2], mulberry32(seed))[2]);
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
