/**
 * POST /v1/merchants/:merchantId/refunds, the wired refund endpoint.
 *
 * Before this, refunds were a 501 stub (POST /v1/refunds, FP-212). The
 * route takes the merchant only from the path checked against the caller,
 * maps the body explicitly, requires the client's Idempotency-Key, and is
 * limited to owner and finance (and API keys).
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth/passwords.js";
import { parseCookie } from "../testing/adminFixtures.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "merchantRefunds.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  OTP_DEV_EXPOSE: "true",
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


const refund = (merchantId: string, headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: "POST", url: `/v1/merchants/${merchantId}/refunds`, headers, payload: payload as object });

test("a full refund through the route succeeds and is replayed on retry", async () => {
  const m = await createApprovedMerchantWithApiKey("route-full");
  const txn = await capturedTransaction(m.rawKey, 5_000);
  const headers = { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() };
  const first = await refund(m.merchantId, headers, { transactionId: txn });
  assert.equal(first.statusCode, 200, first.body);
  const again = await refund(m.merchantId, headers, { transactionId: txn });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), first.json(), "same key, same answer");
  const row = await pool.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1`, [txn]);
  assert.equal(Number(row.rows[0]!.refunded_fils), 5_000, "refunded once");
});

test("a partial refund through the route succeeds", async () => {
  const m = await createApprovedMerchantWithApiKey("route-partial");
  const txn = await capturedTransaction(m.rawKey, 5_000);
  const res = await refund(m.merchantId, { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() }, {
    transactionId: txn,
    amountFils: 1_250,
    reason: "item returned",
  });
  assert.equal(res.statusCode, 200, res.body);
});

test("the Idempotency-Key header is required", async () => {
  const m = await createApprovedMerchantWithApiKey("route-nokey");
  const txn = await capturedTransaction(m.rawKey, 5_000);
  const res = await refund(m.merchantId, { authorization: `Bearer ${m.rawKey}` }, { transactionId: txn });
  assert.equal(res.statusCode, 400, res.body);
});

test("another merchant's path or transaction is refused", async () => {
  const a = await createApprovedMerchantWithApiKey("route-a");
  const b = await createApprovedMerchantWithApiKey("route-b");
  const bTxn = await capturedTransaction(b.rawKey, 5_000);
  const headers = { authorization: `Bearer ${a.rawKey}`, "idempotency-key": randomUUID() };
  assert.equal((await refund(b.merchantId, headers, { transactionId: bTxn })).statusCode, 403, "someone else's path");
  assert.equal((await refund(a.merchantId, headers, { transactionId: bTxn })).statusCode, 404, "someone else's transaction");
});

test("a merchantId in the body is ignored, never used", async () => {
  const a = await createApprovedMerchantWithApiKey("route-body-a");
  const b = await createApprovedMerchantWithApiKey("route-body-b");
  const bTxn = await capturedTransaction(b.rawKey, 5_000);
  const res = await refund(a.merchantId, { authorization: `Bearer ${a.rawKey}`, "idempotency-key": randomUUID() }, {
    transactionId: bTxn,
    merchantId: b.merchantId,
  });
  assert.equal(res.statusCode, 404, res.body);
});

test("malformed input is a 400", async () => {
  const m = await createApprovedMerchantWithApiKey("route-bad");
  const headers = { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() };
  assert.equal((await refund(m.merchantId, headers, {})).statusCode, 400, "no transactionId");
  assert.equal((await refund(m.merchantId, headers, { transactionId: "not-a-uuid" })).statusCode, 400);
  assert.equal((await refund(m.merchantId, headers, { transactionId: randomUUID(), amountFils: "12" })).statusCode, 400);
});

test("a merchant support user can't refund", async () => {
  const m = await createApprovedMerchantWithApiKey("route-support");
  const txn = await capturedTransaction(m.rawKey, 5_000);
  const email = `support-${randomUUID()}@example.test`;
  const password = "refund support password 1!";
  await pool.query(`INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'support', $3)`, [
    m.merchantId,
    email,
    await hashPassword(password, config),
  ]);
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId: m.merchantId, email, password } });
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: parseCookie(login.headers["set-cookie"], config.cookieName) },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  const cookie = parseCookie(verify.headers["set-cookie"], config.cookieName);
  const res = await refund(m.merchantId, { cookie, "idempotency-key": randomUUID() }, { transactionId: txn });
  assert.equal(res.statusCode, 403, res.body);
});

const inject = (method: "POST", url: string, rawKey: string, payload: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() }, payload });

async function partiallyCapturedTransaction(rawKey: string, amountFils: number, captureFils: number): Promise<string> {
  const auth = await inject("POST", "/v1/transactions", rawKey, { amountFils, card: VALID_CARD, reference: "partial" });
  assert.equal(auth.statusCode, 201, auth.body);
  const id = (auth.json() as { id: string }).id;
  const cap = await inject("POST", `/v1/transactions/${id}/capture`, rawKey, { amountFils: captureFils });
  assert.equal(cap.statusCode, 200, cap.body);
  return id;
}

test("capturing the rest after a refund keeps the status in line with the refunded amount", async () => {
  // docs/bugs/006: capture worked the status out from captured vs authorized
  // only, so a refunded part was forgotten and the row said 'captured'.
  const m = await createApprovedMerchantWithApiKey("recapture-after-refund");
  const txn = await partiallyCapturedTransaction(m.rawKey, 10_000, 4_000);
  const refunded = await refund(m.merchantId, { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() }, { transactionId: txn });
  assert.equal(refunded.statusCode, 200, refunded.body);

  const rest = await inject("POST", `/v1/transactions/${txn}/capture`, m.rawKey, {});
  assert.equal(rest.statusCode, 200, rest.body);
  assert.equal((rest.json() as { status: string }).status, "partially_refunded");
  const row = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [txn]);
  assert.equal(row.rows[0]!.status, "partially_refunded");
  // Fully captured, so the hold is released and the event is a full capture.
  const hold = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [txn]);
  assert.equal(hold.rows[0]!.status, "released");
  const events = await pool.query<{ event_type: string }>(
    `SELECT event_type FROM transaction_events WHERE transaction_id = $1 AND event_type LIKE '%captured' ORDER BY occurred_at, id`,
    [txn],
  );
  assert.deepEqual(events.rows.map((r) => r.event_type).sort(), ["captured", "partially_captured"]);
});

test("a refund moves the cached payable balance with the ledger (docs/bugs/014)", async () => {
  const m = await createApprovedMerchantWithApiKey("refund-cache");
  const txn = await capturedTransaction(m.rawKey, 10_000);
  const res = await refund(m.merchantId, { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() }, {
    transactionId: txn,
    amountFils: 4_000,
  });
  assert.equal(res.statusCode, 200, res.body);

  const ledger = await pool.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS net
       FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'`,
    [m.merchantId],
  );
  const cache = await pool.query<{ v: string }>(
    `SELECT cached_payable_fils::text AS v FROM merchant_balances WHERE merchant_id = $1`,
    [m.merchantId],
  );
  assert.equal(Number(cache.rows[0]!.v), Number(ledger.rows[0]!.net));
});
