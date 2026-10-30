/**
 * A merchant can only refund its own transactions.
 *
 * Before the fix initiateMerchantRefund looked the transaction up by id
 * alone and passed the TRANSACTION's merchant to processRefund, so the
 * "scoped to the caller's merchant" lookup inside processRefund always
 * matched: merchant A could refund merchant B's payment (and the refund's
 * idempotency key lived in B's namespace). Latent while the route was a 501
 * stub; the first wiring would have exposed it.
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
import { initiateMerchantRefund } from "./initiateMerchantRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "initiateMerchantRefund.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
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

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

const approvingAcquirer: AcquirerSimulator = {
  authorize() {
    throw new Error("approvingAcquirer: authorize is not used by these tests");
  },
  capture() {
    throw new Error("approvingAcquirer: capture is not used by these tests");
  },
  refund(req): Promise<AcquirerRefundResult> {
    return Promise.resolve({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 });
  },
};

async function createApprovedMerchantWithApiKey(label: string) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Initiate Merchant ${label} ${randomUUID()}`],
  );
  const merchantId = merchantResult.rows[0]!.id;

  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests')
     RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const ownerUserId = userResult.rows[0]!.id;

  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label });

  const keyResult = await pool.query<{ id: string }>(
    `SELECT id FROM api_keys WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [merchantId],
  );
  const apiKeyId = keyResult.rows[0]!.id;

  return {
    merchantId,
    rawKey: issued.rawKey,
    actor: { type: "merchant_api_key" as const, id: apiKeyId },
  };
}

async function capturedTransaction(rawKey: string, amountFils: number): Promise<string> {
  const authorizeRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "initiate-test" },
  });
  assert.equal(authorizeRes.statusCode, 201, authorizeRes.body);
  const txn = authorizeRes.json() as { id: string };

  const captureRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(captureRes.statusCode, 200, captureRes.body);
  return txn.id;
}


test("a merchant cannot refund another merchant's transaction", async () => {
  const victim = await createApprovedMerchantWithApiKey("refund-victim");
  const attacker = await createApprovedMerchantWithApiKey("refund-attacker");
  const victimTxn = await capturedTransaction(victim.rawKey, 5_000);

  const result = await initiateMerchantRefund(pool, approvingAcquirer, {
    merchantId: attacker.merchantId,
    transactionId: victimTxn,
    idempotencyKey: randomUUID(),
    actor: attacker.actor,
  }).catch((err: { statusCode?: number }) => ({ statusCode: err.statusCode ?? 500, body: err }));

  assert.equal(result.statusCode, 404, JSON.stringify(result.body));
  const row = await pool.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1`, [victimTxn]);
  assert.equal(Number(row.rows[0]!.refunded_fils), 0, "the victim's transaction must not be refunded");
});

test("the refunds-on-hold check applies to the caller's merchant", async () => {
  const m = await createApprovedMerchantWithApiKey("refund-hold");
  const txn = await capturedTransaction(m.rawKey, 5_000);
  await pool.query(`UPDATE merchants SET refunds_enabled = false WHERE id = $1`, [m.merchantId]);
  await assert.rejects(
    initiateMerchantRefund(pool, approvingAcquirer, {
      merchantId: m.merchantId,
      transactionId: txn,
      amountFils: toFils(1_000),
      idempotencyKey: randomUUID(),
      actor: m.actor,
    }),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
});
