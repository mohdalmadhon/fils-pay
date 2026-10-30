/**
 * Capture prices its fee at the same instant its capture event is dated
 * (the database's now(), which settlement reads back), not at the API
 * server's clock some time later. docs/bugs/015.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { captureTransactionWithClient } from "./capture.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("captureFeeClock.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

const acquirer = {
  async capture(req: { acquirerReference: string }) {
    return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
  },
} as unknown as AcquirerSimulator;

test("a fee schedule that starts between the transaction's start and the app clock does not apply", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Fee clock ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'authorized', 10000, 0, $2) RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const started = await client.query<{ now: Date }>("SELECT now() AS now");
    // A new rate that takes effect 300 ms after this transaction began
    // (think: a lock wait across midnight), committed by someone else.
    await pool.query(
      `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from) VALUES ($1, 100, $2::timestamptz + interval '300 milliseconds')`,
      [merchantId, started.rows[0]!.now],
    );
    await new Promise((resolve) => setTimeout(resolve, 600));

    const result = await captureTransactionWithClient(client, acquirer, {
      transactionId: txn.rows[0]!.id,
      merchantId,
      idempotencyKey: randomUUID(),
      actor: { type: "system", id: merchantId },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    const event = await client.query<{ occurred_at: Date; metadata: { chargedMdrBps: number; feeFils: number } }>(
      `SELECT occurred_at, metadata FROM transaction_events WHERE transaction_id = $1 AND event_type = 'captured'`,
      [txn.rows[0]!.id],
    );
    await client.query("COMMIT");
    // The event is dated before the new rate, so settlement charges 250 bps;
    // capture must have charged the same.
    assert.ok(event.rows[0]!.occurred_at < new Date(started.rows[0]!.now.getTime() + 300));
    assert.equal(event.rows[0]!.metadata.chargedMdrBps, 250);
    assert.equal(event.rows[0]!.metadata.feeFils, 250);
  } finally {
    client.release();
  }
});
