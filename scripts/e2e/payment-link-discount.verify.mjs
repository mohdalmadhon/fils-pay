/** Run with node --import tsx against a disposable migrated database.
 * Exercises real checkout, discount replay, and a failure at finalization.
 * The acquirer is scripted; the API/settlement/webhook check is payment-check.mjs.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { payPaymentLink } from "../../apps/api/src/paymentLinks/pay.ts";
import { applyCaptureDiscountAdjustment } from "../../apps/api/src/payments/discountAdjustment.ts";

if (!process.env.DATABASE_URL) throw new Error("Use a disposable migrated DATABASE_URL");
// One connection also catches accidentally opening a nested transaction.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const config = { paymentLinkReservationTimeoutSeconds: 60 };
let captures = 0;
const acquirer = {
  authorize: async () => ({ outcome: "approved", acquirerReference: randomUUID(), latencyMs: 0 }),
  capture: async ({ acquirerReference }) => {
    captures++;
    return { outcome: "approved", acquirerReference, latencyMs: 0 };
  },
};

async function fixture(amount, rate, discount) {
  const merchantId = (await pool.query(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps, onboarding_status, kyc_passed)
     VALUES ('Payment-link discount verification', $1, $2, 'approved', true) RETURNING id`,
    [rate, discount],
  )).rows[0].id;
  const token = randomUUID();
  const linkId = (await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, $3, now() + interval '1 hour', 'merchant_api_key', $4) RETURNING id`,
    [merchantId, token, amount, randomUUID()],
  )).rows[0].id;
  return { merchantId, token, linkId };
}

async function verifyCheckout(amount, rate, discount, expectedFee, expectedRebate) {
  const f = await fixture(amount, rate, discount);
  const input = { token: f.token, card, idempotencyKey: randomUUID() };
  const beforeCaptures = captures;
  const result = await payPaymentLink(pool, acquirer, config, input);
  assert.equal(result.statusCode, 200);
  const transactionId = result.body.transactionId;
  const event = (await pool.query(
    "SELECT metadata FROM transaction_events WHERE transaction_id = $1 AND event_type = 'captured'",
    [transactionId],
  )).rows[0].metadata;
  assert.equal(event.feeFils, expectedFee, "timeline must carry the net fee");
  assert.equal(event.feeBeforeDiscountFils, expectedFee + expectedRebate);
  assert.equal(event.negotiatedDiscountAppliedFils, expectedRebate);
  const outbox = (await pool.query(
    "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'transaction.captured'",
    [transactionId],
  )).rows;
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].payload.feeFils, expectedFee, "webhook source must carry the net fee");
  const balances = (await pool.query(
    `SELECT account_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text net
     FROM ledger_entries WHERE transaction_id = $1 GROUP BY account_id`, [transactionId],
  )).rows;
  assert.equal(Number(balances.find(r => r.account_id === "platform_fee_revenue")?.net ?? 0), expectedFee);
  assert.equal(Number(balances.find(r => r.account_id === "merchant_payable").net), amount - expectedFee);
  const cache = (await pool.query("SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1", [f.merchantId])).rows[0];
  assert.equal(Number(cache.cached_payable_fils), amount - expectedFee);
  const before = (await pool.query("SELECT count(*) FROM ledger_entries WHERE transaction_id = $1", [transactionId])).rows[0].count;
  await applyCaptureDiscountAdjustment(pool, { merchantId: f.merchantId, transactionId });
  assert.equal((await pool.query("SELECT count(*) FROM ledger_entries WHERE transaction_id = $1", [transactionId])).rows[0].count, before);
  assert.equal((await payPaymentLink(pool, acquirer, config, input)).statusCode, 409);
  assert.equal(captures - beforeCaptures, 1, "replay must not charge or rebate twice");
  console.log(`PASS checkout ${amount} fils / ${discount} bps discount: net fee ${expectedFee}, rebate ${expectedRebate}; replay unchanged`);
}

try {
  await verifyCheckout(47_333, 275, 1250, 1139, 163);
  await verifyCheckout(47_333, 275, 0, 1302, 0);
  await verifyCheckout(21, 250, 1250, 0, 1);

  const f = await fixture(47_333, 275, 1250);
  let reachedFinalization = false;
  const failingPool = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, property) {
          if (property === "query") return async (sql, params) => {
            if (typeof sql === "string" && sql.includes("SET status = 'paid'")) {
              reachedFinalization = true;
              const rebate = await target.query(
                "SELECT amount_fils FROM ledger_entries WHERE merchant_id = $1 AND description = 'capture: negotiated discount adjustment' AND direction = 'credit'", [f.merchantId],
              );
              assert.equal(Number(rebate.rows[0].amount_fils), 163);
              throw new Error("synthetic finalization failure");
            }
            return target.query(sql, params);
          };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  await assert.rejects(
    payPaymentLink(failingPool, acquirer, config, { token: f.token, card, idempotencyKey: randomUUID() }),
    /synthetic finalization failure/,
  );
  assert(reachedFinalization);
  const tx = (await pool.query("SELECT id, status, captured_fils FROM transactions WHERE merchant_id = $1", [f.merchantId])).rows[0];
  assert.equal(tx.status, "authorized");
  assert.equal(Number(tx.captured_fils), 0);
  for (const table of ["ledger_entries", "merchant_balances"]) {
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE merchant_id = $1`, [f.merchantId])).rows[0].n, 0);
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'transaction.captured'", [tx.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM transaction_events WHERE transaction_id = $1 AND event_type = 'captured'", [tx.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT status FROM payment_links WHERE id = $1", [f.linkId])).rows[0].status, "reserved");
  console.log("PASS finalization failure rolls back capture, discount, cache, timeline and outbox together");
} finally {
  await pool.end();
}
