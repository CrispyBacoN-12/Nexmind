import "dotenv/config"; // shadowOrderStore.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionShadowOrderStatus } from "./shadowOrderStore";

test("canTransitionShadowOrderStatus: non-terminal -> anything is always allowed", () => {
  assert.equal(canTransitionShadowOrderStatus("pending", "open"), true);
  assert.equal(canTransitionShadowOrderStatus("open", "filled"), true);
  assert.equal(canTransitionShadowOrderStatus("filled", "closed"), true);
});

test("canTransitionShadowOrderStatus: terminal -> a different status is rejected (the round-3 monotonicity bug)", () => {
  assert.equal(canTransitionShadowOrderStatus("closed", "filled"), false);
  assert.equal(canTransitionShadowOrderStatus("cancelled", "open"), false);
  assert.equal(canTransitionShadowOrderStatus("rejected", "pending"), false);
});

test("canTransitionShadowOrderStatus: terminal -> the SAME terminal status is allowed (field-only corrections)", () => {
  assert.equal(canTransitionShadowOrderStatus("closed", "closed"), true);
});
