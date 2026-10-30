/**
 * refund_merchant_summary (materialized view, 0072, recreated in 0086): one
 * row per merchant per Bahrain business day of succeeded refunds.
 *
 * Before the fix the view joined `transactions t ON t.id = r.id` (a refund
 * id is never a transaction id), so it was always empty, and
 * SUM(t.captured_fils) would have counted a transaction once per refund.
 * docs/bugs/083-refund-merchant-summary-always-empty.md.
 *
 * Runs in a transaction that is rolled back (the refresh too). Requires
 * DATABASE_URL pointing at a migrated database.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/refundMerchantSummary.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("refundMerchantSummary.integration.test.ts requires DATABASE_URL");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

test("refund_merchant_summary counts each refunded transaction's capture once", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const m = (
      await client.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
        `Refund Summary ${randomUUID()}`,
      ])
    ).rows[0]!.id;
    const txn = async (captured: number) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
           VALUES ($1, 'partially_refunded', $2, $2, $3) RETURNING id`,
          [m, captured, `ref-${randomUUID()}`],
        )
      ).rows[0]!.id;
    // 10:00 Bahrain on 2026-10-01 (07:00 UTC), and 23:30 Bahrain the same day
    // (20:30 UTC). 2026-10-02 01:00 Bahrain (2026-10-01 22:00 UTC) is the
    // next business day.
    const refund = (transactionId: string, amount: number, fee: number, at: string, status = "succeeded") =>
      client.query(
        `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
                              acquirer_reference, reason, created_by_type, created_by_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'test', 'merchant_session', $7, $8)`,
        [transactionId, m, amount, fee, status, `rf-${randomUUID()}`, randomUUID(), at],
      );
    const a = await txn(10_000);
    const b = await txn(5_000);
    await refund(a, 3_000, 75, "2026-10-01T07:00:00Z");
    await refund(a, 2_000, 50, "2026-10-01T20:30:00Z");
    await refund(b, 1_000, 25, "2026-10-01T07:00:00Z");
    await refund(b, 4_000, 0, "2026-10-01T07:00:00Z", "failed");
    await refund(b, 500, 12, "2026-10-01T22:00:00Z");

    await client.query(`REFRESH MATERIALIZED VIEW refund_merchant_summary`);
    const rows = await client.query(
      `SELECT business_date::date::text AS day, refund_count::int, total_refunded_fils::int,
              total_fee_reversed_fils::int, original_captured_fils::int
         FROM refund_merchant_summary WHERE merchant_id = $1 ORDER BY business_date`,
      [m],
    );
    assert.deepEqual(rows.rows, [
      // a counted once (10,000) although it has two refunds that day, plus b.
      { day: "2026-10-01", refund_count: 3, total_refunded_fils: 6_000, total_fee_reversed_fils: 150, original_captured_fils: 15_000 },
      { day: "2026-10-02", refund_count: 1, total_refunded_fils: 500, total_fee_reversed_fils: 12, original_captured_fils: 5_000 },
    ]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
