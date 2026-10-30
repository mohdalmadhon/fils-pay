/**
 * A merchant with a negotiated discount is charged, at capture, exactly the
 * fee settlement will charge (ComputeSettlementFee: the discount comes off
 * the amount before the MDR, docs/ARCHITECTURE.md "Settlement"), through
 * both capture paths: the API capture route and a paid payment link.
 *
 * Before the fix:
 *  - the API route charged the full MDR and then reversed "discount x fee"
 *    in a separate adjustment, a different formula that can differ by a fil
 *    (10,021 fils at 250 bps with a 10 % discount: 226 vs 225);
 *  - payment-link captures got no discount at all.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { settlementFeeFils } from "../fees/settlementFee.js";
import { getVolumeTierBonusBps } from "../fees/platformVolumeTier.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("captureDiscount.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const MDR_BPS = 250;
const DISCOUNT_BPS = 1_000; // 10 %
const AMOUNT = 10_021; // the two discount formulas round differently here
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function discountedMerchant() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`Capture Discount ${randomUUID()}`, MDR_BPS, DISCOUNT_BPS],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'x') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "discount" });
  return { merchantId, headers: { authorization: `Bearer ${key.rawKey}` } };
}

async function expectedFee(): Promise<number> {
  const client = await pool.connect();
  try {
    const tier = await getVolumeTierBonusBps(client);
    return settlementFeeFils(AMOUNT, Math.max(0, MDR_BPS - tier), DISCOUNT_BPS);
  } finally {
    client.release();
  }
}

async function netFeeCharged(transactionId: string): Promise<number> {
  const r = await pool.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue'`,
    [transactionId],
  );
  return Number(r.rows[0]!.net);
}

test("API capture charges the settlement fee for a discounted merchant", async () => {
  const m = await discountedMerchant();
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...m.headers, "idempotency-key": randomUUID() },
    payload: { amountFils: AMOUNT, card: CARD, reference: "discount-api" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${transactionId}/capture`,
    headers: { ...m.headers, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);
  assert.equal(await netFeeCharged(transactionId), await expectedFee());
});

test("a paid payment link charges the same discounted fee", async () => {
  const m = await discountedMerchant();
  const link = await app.inject({
    method: "POST",
    url: `/v1/merchants/${m.merchantId}/payment-links`,
    headers: m.headers,
    payload: { amountFils: AMOUNT, reference: "discount-link", description: "x", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(link.statusCode, 201, link.body);
  const paid = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${(link.json() as { token: string }).token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  assert.equal(paid.statusCode, 200, paid.body);
  const transactionId = (paid.json() as { transactionId: string }).transactionId;
  assert.equal(await netFeeCharged(transactionId), await expectedFee());
});
