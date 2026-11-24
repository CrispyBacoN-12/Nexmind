// The local holdings file. Every test uses its own temp dir, never .local/,
// and made-up tickers only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isDeployed, isLocalRequest } from "./localOnly";
import { deleteHolding, parseHoldingInput, readHoldings, setProfiles, upsertHolding } from "./store";

const tmpFile = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "holdings-")), "nested", "holdings.json");

test("parseHoldingInput", () => {
  const ok = parseHoldingInput({ ticker: " aaa ", shares: "2.5", avgCost: "10" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { ticker: "AAA", shares: 2.5, avgCost: 10, note: "" });
  for (const bad of [{ shares: "0" }, { shares: "-1" }, { shares: "x" }, { avgCost: "0" }, { ticker: "not a ticker" }]) {
    assert.equal(parseHoldingInput({ ticker: "AAA", shares: "1", avgCost: "1", ...bad }).ok, false, JSON.stringify(bad));
  }
});

test("readHoldings: missing file → []", async () => {
  assert.deepEqual(await readHoldings(await tmpFile()), []);
});

test("readHoldings: malformed file is an error, not []", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "holdings-"));
  const file = path.join(dir, "holdings.json");
  await writeFile(file, "{oops");
  await assert.rejects(readHoldings(file), /not valid JSON/);
  assert.equal(await readFile(file, "utf8"), "{oops");
});

test("upsertHolding: adds then updates, sorted", async () => {
  const file = await tmpFile();
  await upsertHolding({ ticker: "BBB", shares: 1, avgCost: 10, note: "" }, file);
  const rows = await upsertHolding({ ticker: "AAA", shares: 2, avgCost: 20, note: "x" }, file);
  assert.deepEqual(rows.map((r) => r.ticker), ["AAA", "BBB"]);
  assert.equal(rows[0].kind, null);
  assert.equal(rows[0].industry, null);
  assert.deepEqual((await readHoldings(file)).map((r) => r.ticker), ["AAA", "BBB"]);
});

test("upsertHolding: keeps cached profile", async () => {
  const file = await tmpFile();
  await upsertHolding({ ticker: "BBB", shares: 1, avgCost: 10, note: "" }, file);
  await setProfiles([{ ticker: "BBB", kind: "stock", industry: "Semiconductors" }], file);
  const rows = await upsertHolding({ ticker: "BBB", shares: 3.25, avgCost: 11, note: "" }, file);
  assert.equal(rows[0].shares, 3.25);
  assert.equal(rows[0].avgCost, 11);
  assert.equal(rows[0].kind, "stock");
  assert.equal(rows[0].industry, "Semiconductors");
});

test("deleteHolding removes only that ticker; absent is a no-op", async () => {
  const file = await tmpFile();
  await upsertHolding({ ticker: "AAA", shares: 1, avgCost: 1, note: "" }, file);
  await upsertHolding({ ticker: "BBB", shares: 1, avgCost: 1, note: "" }, file);
  assert.deepEqual((await deleteHolding("AAA", file)).map((r) => r.ticker), ["BBB"]);
  assert.deepEqual((await deleteHolding("ZZZ", file)).map((r) => r.ticker), ["BBB"]);
});

test("isDeployed", () => {
  assert.equal(isDeployed({ VERCEL: "1" }), true);
  assert.equal(isDeployed({}), false);
});

test("isLocalRequest: only localhost hosts and same-origin writes", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(isLocalRequest(h({ host: "localhost:3275" })), true);
  assert.equal(isLocalRequest(h({ host: "127.0.0.1:3275" })), true);
  assert.equal(isLocalRequest(h({ host: "[::1]:3275" })), true);
  assert.equal(isLocalRequest(h({ host: "192.168.1.20:3275" })), false); // another device on the Wi-Fi
  assert.equal(isLocalRequest(h({ host: "evil.example:3275" })), false); // DNS rebinding
  assert.equal(isLocalRequest(h({})), false);
  assert.equal(isLocalRequest(h({ host: "localhost:3275", origin: "http://localhost:3275" })), true);
  assert.equal(isLocalRequest(h({ host: "localhost:3275", origin: "https://evil.example" })), false); // cross-site POST
});
