/**
 * Regression tests for "concurrent refunds: double money out".
 *
 * Two refund requests for the same transaction that arrive at the same time
 * (different idempotency keys, e.g. two support agents, or a merchant
 * integration retrying with a fresh key) used to both pass validation against
 * the same stale refunded total, both call the acquirer, and both journal —
 * paying the cardholder twice. Refunds now hold the transaction row lock from
 * validation through the acquirer call to the journal, exactly like capture.
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
import type { AcquirerOutcome, AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "processRefundConcurrency.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
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

const pool = new Pool({ connectionString: databaseUrl, max: 20 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** An acquirer whose refund outcome is fixed, so a decline or a transport
 *  error is exercised without depending on the simulator's RNG. */
function fixedAcquirer(outcome: AcquirerOutcome): AcquirerSimulator {
  return {
    authorize() {
      throw new Error("fixedAcquirer: authorize is not used by these tests");
    },
    capture() {
      throw new Error("fixedAcquirer: capture is not used by these tests");
    },
    refund(req): Promise<AcquirerRefundResult> {
      return Promise.resolve({ outcome, acquirerReference: req.acquirerReference, latencyMs: 0 });
    },
  };
}

const approvingAcquirer = fixedAcquirer("approved");

async function createApprovedMerchantWithApiKey(label: string, mdrBps = 250) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Refund Merchant ${label} ${randomUUID()}`, mdrBps],
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

  return { merchantId, ownerUserId, rawKey: issued.rawKey };
}

/** Authorizes `amountFils` and captures `captureFils` (everything, by
 *  default) through the real routes, returning the transaction id. */
async function capturedTransaction(
  rawKey: string,
  amountFils: number,
  captureFils?: number,
): Promise<{ id: string }> {
  const authorizeRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "refund-test" },
  });
  assert.equal(authorizeRes.statusCode, 201, authorizeRes.body);
  const txn = authorizeRes.json() as { id: string };

  const captureRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: captureFils === undefined ? {} : { amountFils: captureFils },
  });
  assert.equal(captureRes.statusCode, 200, captureRes.body);

  return { id: txn.id };
}

/** The api key these tests already hold, as a writer actor — the same shape
 *  `requireMerchantWriterActor()` hands the route layer. */
async function apiKeyActor(merchantId: string): Promise<{ type: "merchant_api_key"; id: string }> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM api_keys WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [merchantId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("apiKeyActor: no api key for merchant");
  return { type: "merchant_api_key", id: row.id };
}


/** Approves every refund after a delay (so concurrent requests really do
 *  overlap at the acquirer) and records how much money it sent out. */
function slowCountingAcquirer(delayMs = 75): AcquirerSimulator & { refundedOut: () => number; calls: () => number } {
  let total = 0;
  let calls = 0;
  return {
    authorize() {
      throw new Error("not used");
    },
    capture() {
      throw new Error("not used");
    },
    async refund(req): Promise<AcquirerRefundResult> {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      total += req.amountFils;
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: delayMs };
    },
    refundedOut: () => total,
    calls: () => calls,
  };
}

async function refundState(transactionId: string) {
  const txn = await pool.query<{ refunded_fils: string; status: string }>(
    `SELECT refunded_fils, status FROM transactions WHERE id = $1`,
    [transactionId],
  );
  const refunds = await pool.query<{ c: number; total: string | null }>(
    `SELECT COUNT(*)::int AS c, SUM(amount_fils)::text AS total FROM refunds WHERE transaction_id = $1`,
    [transactionId],
  );
  const ledger = await pool.query<{ total: string | null }>(
    `SELECT SUM(amount_fils)::text AS total FROM ledger_entries
      WHERE transaction_id = $1 AND account_id = 'card_scheme_clearing' AND direction = 'credit'`,
    [transactionId],
  );
  return {
    refundedFils: Number(txn.rows[0]!.refunded_fils),
    status: txn.rows[0]!.status,
    refundRows: refunds.rows[0]!.c,
    refundTotal: Number(refunds.rows[0]!.total ?? 0),
    ledgerRefundTotal: Number(ledger.rows[0]!.total ?? 0),
  };
}

test("two simultaneous full refunds: exactly one goes through, money leaves once", async () => {
  const merchant = await createApprovedMerchantWithApiKey("concurrent-full");
  const txn = await capturedTransaction(merchant.rawKey, 10_000);
  const actor = await apiKeyActor(merchant.merchantId);
  const acquirer = slowCountingAcquirer();

  const results = await Promise.all(
    [randomUUID(), randomUUID()].map((idempotencyKey) =>
      processRefund(pool, acquirer, { transactionId: txn.id, merchantId: merchant.merchantId, idempotencyKey, actor }),
    ),
  );

  // The loser waits for the winner's lock, then sees a fully refunded
  // transaction and is refused.
  const codes = results.map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify(results.map((r) => r.body)));
  const loser = results.find((r) => r.statusCode === 409)!;
  assert.deepEqual(loser.body, { ok: false, code: "transaction_not_refundable", status: "refunded" });
  assert.equal(acquirer.calls(), 1, "the acquirer must be asked to refund only once");
  assert.equal(acquirer.refundedOut(), 10_000);

  const state = await refundState(txn.id);
  assert.equal(state.refundedFils, 10_000);
  assert.equal(state.status, "refunded");
  assert.equal(state.refundRows, 1);
  assert.equal(state.ledgerRefundTotal, 10_000);
});

test("five simultaneous partial refunds never return more than was captured", async () => {
  const merchant = await createApprovedMerchantWithApiKey("concurrent-partial");
  const txn = await capturedTransaction(merchant.rawKey, 10_000);
  const actor = await apiKeyActor(merchant.merchantId);
  const acquirer = slowCountingAcquirer();

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      processRefund(pool, acquirer, {
        transactionId: txn.id,
        merchantId: merchant.merchantId,
        amountFils: toFils(3_000),
        idempotencyKey: randomUUID(),
        actor,
      }),
    ),
  );

  const succeeded = results.filter((r) => r.statusCode === 200).length;
  assert.equal(succeeded, 3, JSON.stringify(results.map((r) => r.body)));
  assert.equal(acquirer.refundedOut(), 9_000);

  const state = await refundState(txn.id);
  assert.equal(state.refundedFils, 9_000, "refunded_fils must count every refund that went out");
  assert.equal(state.refundTotal, 9_000);
  assert.equal(state.ledgerRefundTotal, 9_000);
  assert.equal(state.status, "partially_refunded");
});

test("a double-click (same idempotency key, same moment) refunds once", async () => {
  const merchant = await createApprovedMerchantWithApiKey("concurrent-same-key");
  const txn = await capturedTransaction(merchant.rawKey, 6_000);
  const actor = await apiKeyActor(merchant.merchantId);
  const acquirer = slowCountingAcquirer();
  const idempotencyKey = randomUUID();

  const results = await Promise.all(
    [1, 2].map(() =>
      processRefund(pool, acquirer, { transactionId: txn.id, merchantId: merchant.merchantId, idempotencyKey, actor }),
    ),
  );

  for (const r of results) assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(results[0]!.body, results[1]!.body, "the second request replays the first response");
  assert.equal(acquirer.calls(), 1);
  assert.equal((await refundState(txn.id)).refundRows, 1);
});

test("a partially captured transaction can never be refunded more than was captured", async () => {
  const merchant = await createApprovedMerchantWithApiKey("over-captured");
  const txn = await capturedTransaction(merchant.rawKey, 10_000, 4_000);
  const actor = await apiKeyActor(merchant.merchantId);
  const acquirer = slowCountingAcquirer(0);

  const tooMuch = await processRefund(pool, acquirer, {
    transactionId: txn.id,
    merchantId: merchant.merchantId,
    amountFils: toFils(10_000),
    idempotencyKey: randomUUID(),
    actor,
  });
  assert.equal(tooMuch.statusCode, 422, JSON.stringify(tooMuch.body));
  assert.deepEqual(tooMuch.body, { ok: false, code: "refund_exceeds_refundable", refundableFils: 4_000 });

  const all = await processRefund(pool, acquirer, {
    transactionId: txn.id,
    merchantId: merchant.merchantId,
    idempotencyKey: randomUUID(),
    actor,
  });
  assert.equal(all.statusCode, 200, JSON.stringify(all.body));
  assert.equal(acquirer.refundedOut(), 4_000, "a blank amount refunds what was captured, not what was authorized");
});

test("a refund is scoped to the merchant that owns the transaction", async () => {
  const owner = await createApprovedMerchantWithApiKey("scope-owner");
  const other = await createApprovedMerchantWithApiKey("scope-other");
  const txn = await capturedTransaction(owner.rawKey, 5_000);
  const acquirer = slowCountingAcquirer(0);

  const result = await processRefund(pool, acquirer, {
    transactionId: txn.id,
    merchantId: other.merchantId,
    idempotencyKey: randomUUID(),
    actor: await apiKeyActor(other.merchantId),
  });
  assert.equal(result.statusCode, 404);
  assert.equal(acquirer.calls(), 0);
});
