/**
 * A suspended or closed merchant loses access at once: its dashboard sessions
 * and its API keys stop working. And an API key whose scheduled revocation
 * (api_keys.revoke_after) has passed stops working too.
 *
 * Before the fix only login checked merchants.status; live sessions lasted up
 * to 12 hours and API keys kept authorising charges indefinitely. revoke_after
 * was never read (the "sweep job" it relies on doesn't exist). Payment links
 * of a suspended merchant could still be paid.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { createMerchant, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("suspendedMerchantAuth.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const PASSWORD = "suspended merchant test 1!";

async function signedInOwner() {
  const { merchantId, ownerUserId } = await createMerchant(pool, "suspend");
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const email = `owner2-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(PASSWORD, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = parseCookie(login.headers["set-cookie"], config.cookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const key = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label: "suspend test" });
  return { merchantId, cookie, bearer: { authorization: `Bearer ${key.rawKey}` }, apiKeyId: key.id };
}

const me = (cookie: string) => app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
const listTxns = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/transactions", headers });

for (const status of ["suspended", "closed"] as const) {
  test(`a ${status} merchant's session and API key stop working immediately`, async () => {
    const m = await signedInOwner();
    assert.equal((await me(m.cookie)).statusCode, 200);
    assert.equal((await listTxns(m.bearer)).statusCode, 200);

    await pool.query(`UPDATE merchants SET status = $2 WHERE id = $1`, [m.merchantId, status]);

    assert.equal((await me(m.cookie)).statusCode, 401, "session");
    assert.equal((await listTxns(m.bearer)).statusCode, 401, "API key");
  });
}

test("an API key past its revoke_after stops working", async () => {
  const m = await signedInOwner();
  await pool.query(`UPDATE api_keys SET revoke_after = now() + interval '1 hour' WHERE id = $1`, [m.apiKeyId]);
  assert.equal((await listTxns(m.bearer)).statusCode, 200, "scheduled but not yet due");

  await pool.query(`UPDATE api_keys SET revoke_after = now() - interval '1 second' WHERE id = $1`, [m.apiKeyId]);
  assert.equal((await listTxns(m.bearer)).statusCode, 401);
});

test("a suspended merchant's payment links can't be paid", async () => {
  const m = await signedInOwner();
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${m.merchantId}/payment-links`,
    headers: m.bearer,
    payload: { amountFils: 1_000, reference: "suspend-1", description: "x", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const { token } = created.json() as { token: string };

  await pool.query(`UPDATE merchants SET status = 'suspended' WHERE id = $1`, [m.merchantId]);

  const paid = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } },
  });
  assert.equal(paid.statusCode, 409, paid.body);
  assert.equal((paid.json() as { error: string }).error, "merchant_unavailable");
  const txns = await pool.query(`SELECT 1 FROM transactions WHERE merchant_id = $1`, [m.merchantId]);
  assert.equal(txns.rowCount, 0, "no authorization was attempted");
});
