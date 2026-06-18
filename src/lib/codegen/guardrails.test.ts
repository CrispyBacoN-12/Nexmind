import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTarget, resolveWithinProject } from "./guardrails";

test("allows a new page under src/app", () => {
  const r = validateTarget("src/app/analytics/page.tsx");
  assert.equal(r.ok, true);
  assert.equal(r.relPath, "src/app/analytics/page.tsx");
});

test("allows a component", () => {
  assert.equal(validateTarget("src/components/chart.tsx").ok, true);
});

test("normalizes backslashes and ./ prefix", () => {
  const r = validateTarget("./src\\app\\x\\page.tsx");
  assert.equal(r.ok, true);
  assert.equal(r.relPath, "src/app/x/page.tsx");
});

test("blocks path traversal", () => {
  assert.equal(validateTarget("src/app/../../etc/passwd").ok, false);
  assert.equal(validateTarget("../outside.tsx").ok, false);
});

test("blocks absolute paths", () => {
  assert.equal(validateTarget("/etc/hosts").ok, false);
  assert.equal(validateTarget("C:/Windows/x.tsx").ok, false);
});

test("blocks disallowed extensions", () => {
  assert.equal(validateTarget("src/app/x.json").ok, false);
  assert.equal(validateTarget("src/app/x.js").ok, false);
});

test("blocks dirs outside the allowlist", () => {
  assert.equal(validateTarget("src/lib/trading/engine.ts").ok, false);
  assert.equal(validateTarget("prisma/seed.ts").ok, false);
});

test("blocks protected files even in allowed dirs", () => {
  assert.equal(validateTarget("src/app/layout.tsx").ok, false);
  assert.equal(validateTarget("src/app/globals.css").ok, false);
  assert.equal(validateTarget("src/lib/anthropic.ts").ok, false);
});

test("resolveWithinProject returns an absolute path inside the project", () => {
  const root = process.platform === "win32" ? "C:\\proj" : "/proj";
  const r = resolveWithinProject(root, "src/app/x/page.tsx");
  assert.equal(r.ok, true);
  assert.ok(r.absPath && r.absPath.includes("page.tsx"));
});
