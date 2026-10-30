/**
 * Tests for the admin merchant-detail page's "current negotiated rate"
 * lookup, against a real, migrated Postgres (no DB mocking) — same posture
 * as feeSchedule.test.ts alongside it.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getCurrentFeeScheduleForDisplay } from "./currentFeeScheduleDisplay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "currentFeeScheduleDisplay.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

async function insertMerchant(mdrBps: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Current Fee Schedule Test ${randomUUID()}`, mdrBps],
  );
  return result.rows[0]!.id;
}

async function insertSchedule(
  merchantId: string,
  mdrBps: number,
  effectiveFrom: string,
  createdAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from, created_at) VALUES ($1, $2, $3, $4)`,
    [merchantId, mdrBps, effectiveFrom, createdAt],
  );
}

test("returns null for a merchant with no negotiated schedule on file", async () => {
  const merchantId = await insertMerchant(250);
  assert.equal(await getCurrentFeeScheduleForDisplay(pool, merchantId), null);
});

test("returns the row's own rate and dates when a single schedule exists", async () => {
  const merchantId = await insertMerchant(250);
  await insertSchedule(merchantId, 200, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");

  const current = await getCurrentFeeScheduleForDisplay(pool, merchantId);
  assert.equal(current?.mdrBps, 200);
  assert.equal(current?.effectiveFrom.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(current?.createdAt.toISOString(), "2026-06-01T00:00:00.000Z");
});

/** When rows are entered in effective order, created_at and effective_from agree, so either ordering passes this. */
test("returns the most recently entered schedule when rows were entered as they took effect", async () => {
  const merchantId = await insertMerchant(250);
  await insertSchedule(merchantId, 200, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z");
  await insertSchedule(merchantId, 180, "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z");

  const current = await getCurrentFeeScheduleForDisplay(pool, merchantId);
  assert.equal(current?.mdrBps, 180);
  assert.equal(current?.createdAt.toISOString(), "2026-07-01T00:00:00.000Z");
});

// This test used to assert that the backfilled 245 bps row wins, i.e. it
// pinned the display bug fixed in docs/solved-problems/005: payments are
// charged at the rate in effect (225 bps from August), so the display must
// show that one. A backfill only describes its own, older period.
test("shows the rate in effect even when an older period was backfilled later", async () => {
  const merchantId = await insertMerchant(250);
  // A renegotiation entered on the day it took effect, then a backdated
  // correction to an earlier period entered two weeks afterwards.
  await insertSchedule(merchantId, 225, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
  await insertSchedule(merchantId, 245, "2026-03-01T00:00:00Z", "2026-08-15T00:00:00Z");

  const current = await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2026-10-01T00:00:00Z"));
  assert.equal(current?.mdrBps, 225);
  assert.equal(current?.effectiveFrom.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(current?.createdAt.toISOString(), "2026-08-01T00:00:00.000Z");

  // During March–July the backfilled rate is the one in effect.
  const inApril = await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2026-04-15T00:00:00Z"));
  assert.equal(inApril?.mdrBps, 245);
});

// The cases solved-problems/005 verified with a throwaway harness, kept here
// so they stay true.
test("a future schedule is not shown as current until its cutover", async () => {
  const merchantId = await insertMerchant(250);
  await insertSchedule(merchantId, 225, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
  await insertSchedule(merchantId, 199, "2099-01-01T00:00:00Z", "2026-09-01T00:00:00Z");

  assert.equal((await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2098-12-31T23:59:59Z")))?.mdrBps, 225);
  assert.equal((await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2099-01-01T00:00:00Z")))?.mdrBps, 199);
});

test("a merchant with only a future schedule has no current negotiated rate", async () => {
  const merchantId = await insertMerchant(250);
  await insertSchedule(merchantId, 199, "2099-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
  assert.equal(await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2026-10-01T00:00:00Z")), null);
});

test("on the same effective date, the later-entered correction wins", async () => {
  const merchantId = await insertMerchant(250);
  await insertSchedule(merchantId, 230, "2026-08-01T00:00:00Z", "2026-08-01T09:00:00Z");
  await insertSchedule(merchantId, 220, "2026-08-01T00:00:00Z", "2026-08-01T10:00:00Z");
  assert.equal((await getCurrentFeeScheduleForDisplay(pool, merchantId, new Date("2026-09-01T00:00:00Z")))?.mdrBps, 220);
});
