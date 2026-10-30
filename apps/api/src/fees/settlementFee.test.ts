/** Pure tests for the CloseBatch-mirroring fee helpers (no database). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRateFils, toFils } from "@filspay/money";
import { effectiveMdrBpsAt, settlementFeeFils, type FeeScheduleRow } from "./settlementFee.js";

const d = (iso: string) => new Date(iso);

test("effectiveMdrBpsAt picks the newest schedule already in effect", () => {
  const rows: FeeScheduleRow[] = [
    { effectiveFrom: d("2026-03-01T00:00:00+03:00"), createdAt: d("2026-08-15T00:00:00+03:00"), mdrBps: 245 },
    { effectiveFrom: d("2026-08-01T00:00:00+03:00"), createdAt: d("2026-08-01T00:00:00+03:00"), mdrBps: 225 },
  ];
  assert.equal(effectiveMdrBpsAt(rows, d("2026-10-30T02:00:00+03:00"), 250), 225);
  assert.equal(effectiveMdrBpsAt(rows, d("2026-05-01T00:00:00+03:00"), 250), 245);
  assert.equal(effectiveMdrBpsAt(rows, d("2026-01-01T00:00:00+03:00"), 250), 250, "before any schedule: the merchant's own rate");
  assert.equal(effectiveMdrBpsAt([], d("2026-10-30T00:00:00Z"), 250), 250);
});

test("effectiveMdrBpsAt: on the same effective_from, the later-created row wins", () => {
  const rows: FeeScheduleRow[] = [
    { effectiveFrom: d("2026-08-01T00:00:00Z"), createdAt: d("2026-08-01T09:00:00Z"), mdrBps: 230 },
    { effectiveFrom: d("2026-08-01T00:00:00Z"), createdAt: d("2026-08-01T10:00:00Z"), mdrBps: 220 },
  ];
  assert.equal(effectiveMdrBpsAt(rows, d("2026-09-01T00:00:00Z"), 250), 220);
});

test("settlementFeeFils matches capture's applyRateFils when there is no discount", () => {
  for (const amount of [47_333, 12_345, 10_100, 4_747, 1]) {
    assert.equal(settlementFeeFils(amount, 225, 0), Number(applyRateFils(toFils(amount), 225)));
  }
  // 10,100 x 2.5% = 252.5 fils: half-to-even gives 252, not 253.
  assert.equal(settlementFeeFils(10_100, 250, 0), 252);
});

test("settlementFeeFils applies the discount to the amount, like ComputeSettlementFee", () => {
  // amount 100,000, discount 10% -> charged on 90,000; 2.5% of that = 2,250.
  assert.equal(settlementFeeFils(100_000, 250, 1_000), 2_250);
  assert.equal(settlementFeeFils(5_000, 0, 0), 0);
});
