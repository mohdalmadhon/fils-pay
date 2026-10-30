import assert from "node:assert/strict";
import { test } from "node:test";
import { computeResidueFils, monthBounds } from "./reconcile_march.js";

test("computeResidueFils returns the amount lost to 2dp quantization", () => {
  assert.equal(computeResidueFils(4750), 0);
  assert.equal(computeResidueFils(4759), 9);
  assert.equal(computeResidueFils(10), 0);
  assert.equal(computeResidueFils(1), 1);
  assert.equal(computeResidueFils(0), 0);
});

test("monthBounds for March 2026 is the Bahrain month: 31 days from 1 March 00:00 +03:00", () => {
  // docs/bugs/017 and ADR 0009: it used to be the UTC month, which left out
  // Bahrain 1 March 00:00-03:00 and took in Bahrain 1 April 00:00-03:00.
  const { start, end } = monthBounds(2026, 3);
  assert.equal(start.toISOString(), "2026-02-28T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-03-31T21:00:00.000Z");
  assert.equal((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24), 31);
});

test("monthBounds rolls over the year in December", () => {
  const { start, end } = monthBounds(2026, 12);
  assert.equal(start.toISOString(), "2026-11-30T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-12-31T21:00:00.000Z");
});
