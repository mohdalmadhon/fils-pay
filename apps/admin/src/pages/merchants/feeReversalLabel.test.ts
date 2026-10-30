import assert from "node:assert/strict";
import test from "node:test";
import { feeReversalLabel } from "./feeReversalLabel.js";

test("the fee-reversal label uses the current fee schedule's rate, not the base MDR", () => {
  const label = feeReversalLabel({
    currentFeeSchedule: { mdrBps: 175, effectiveFrom: "2026-09-01T00:00:00.000Z", createdAt: "2026-08-20T00:00:00.000Z" },
  });
  assert.match(label, /1\.75%/);
  assert.match(label, /before any volume or negotiated discount/);
});

test("with no fee schedule it names the effective rate instead of a number", () => {
  assert.equal(
    feeReversalLabel({ currentFeeSchedule: null }),
    "Also reverse the MDR on this amount, at the merchant's current effective rate",
  );
});
