/**
 * Regression tests: a refund may never give back more MDR fee than the
 * merchant actually paid.
 *
 * A capture credits the full MDR to platform_fee_revenue; for a merchant with
 * a negotiated discount, applyCaptureDiscountAdjustment then debits part of
 * it back. Refunds used to reverse a share of the gross credit only, so the
 * discounted part came back twice. Separately rounded partial refunds could
 * also sum to more than the fee.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("refundFeeReversal.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const approving: AcquirerSimulator = {
  authorize() {
    throw new Error("not used");
  },
  capture() {
    throw new Error("not used");
  },
  refund(req): Promise<AcquirerRefundResult> {
    return Promise.resolve({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 });
  },
};
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function merchant(discountBps: number) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, 250, $2) RETURNING id`,
    [`Refund Fee ${randomUUID()}`, discountBps],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'x') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id });
  return { merchantId, rawKey: key.rawKey, keyId: key.id };
}

/** Authorize + capture through the real routes, so the discounted fee is posted. */
async function captured(rawKey: string, amountFils: number): Promise<string> {
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: CARD, reference: "fee-test" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const id = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);
  return id;
}

async function feeLedger(transactionId: string) {
  const r = await pool.query<{ credits: string; discount: string; reversed: string }>(
    `SELECT COALESCE(SUM(amount_fils) FILTER (WHERE direction = 'credit'), 0)::text AS credits,
            COALESCE(SUM(amount_fils) FILTER (WHERE description = 'capture: negotiated discount adjustment'), 0)::text AS discount,
            COALESCE(SUM(amount_fils) FILTER (WHERE description = 'refund: MDR fee reversal'), 0)::text AS reversed
       FROM ledger_entries WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue'`,
    [transactionId],
  );
  const row = r.rows[0]!;
  return { gross: Number(row.credits), discount: Number(row.discount), reversed: Number(row.reversed) };
}

function refund(merchantId: string, keyId: string, transactionId: string, amountFils?: number) {
  return processRefund(pool, approving, {
    transactionId,
    merchantId,
    amountFils: amountFils === undefined ? undefined : toFils(amountFils),
    idempotencyKey: randomUUID(),
    actor: { type: "merchant_api_key", id: keyId },
  });
}

test("a full refund for a discounted merchant reverses exactly the fee they paid", async () => {
  const { merchantId, rawKey, keyId } = await merchant(2_000); // 20 % off the MDR
  const txn = await captured(rawKey, 100_000);
  const before = await feeLedger(txn);
  // The discount is now part of the fee capture posts (docs/improvements/06),
  // not a separate adjustment, so check the net fee is below the full MDR.
  assert.ok(before.gross - before.discount < 2_500, "the capture discount must have been applied for this test to mean anything");

  const res = await refund(merchantId, keyId, txn);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const after = await feeLedger(txn);
  assert.equal(after.reversed, before.gross - before.discount, "reverse the net fee, not the gross");
  // The platform ends up keeping nothing and giving nothing extra.
  assert.equal(after.gross - after.discount - after.reversed, 0);
});

test("partial refunds for a discounted merchant never add up to more than the net fee", async () => {
  const { merchantId, rawKey, keyId } = await merchant(3_333);
  const txn = await captured(rawKey, 99_999);
  const { gross, discount } = await feeLedger(txn);
  for (const part of [33_333, 33_333, 33_333]) {
    const res = await refund(merchantId, keyId, txn, part);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  const after = await feeLedger(txn);
  assert.equal(after.reversed, gross - discount, "the last refund reverses exactly what is left");
});

test("rounded partial shares are capped at the fee charged", async () => {
  // Hand-built so the rounding is forced: captured 2 fils, fee 3 fils.
  // Two refunds of 1 fil each round 1.5 -> 2 on their own; 2 + 2 > 3.
  const { merchantId, keyId } = await merchant(0);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 2, 2, $2) RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );
  const txn = t.rows[0]!.id;
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, $3, 'merchant_payable', 'debit', 3, now(), 'capture: MDR fee'),
            ($1, $2, $3, 'platform_fee_revenue', 'credit', 3, now(), 'capture: MDR fee')`,
    [randomUUID(), merchantId, txn],
  );

  assert.equal((await refund(merchantId, keyId, txn, 1)).statusCode, 200);
  assert.equal((await refund(merchantId, keyId, txn, 1)).statusCode, 200);
  const after = await feeLedger(txn);
  assert.equal(after.reversed, 3, `fee reversed ${after.reversed}, charged 3`);
});

test("a merchant without a discount is unaffected", async () => {
  const { merchantId, rawKey, keyId } = await merchant(0);
  const txn = await captured(rawKey, 40_000);
  const { gross } = await feeLedger(txn);
  assert.equal((await refund(merchantId, keyId, txn, 10_000)).statusCode, 200);
  const after = await feeLedger(txn);
  assert.equal(after.reversed, Math.round(gross / 4));
});
