/**
 * The public payment-link page must say a link can't be paid when its
 * merchant is suspended or closed (docs/improvements/16).
 *
 * Paying was already refused (409 merchant_unavailable, docs/cyper), but
 * GET /v1/payment-links/:token still reported "active", so the checkout
 * page showed the card form, and the refused payment then read as
 * "someone is paying this link right now, refresh".
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("paymentLinkSuspendedMerchant.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function merchantWithLink() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Suspended link test ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "suspended link" });
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${key.rawKey}` },
    payload: { amountFils: 4_750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  return { merchantId, token: (created.json() as { token: string }).token };
}

const read = (token: string) => app.inject({ method: "GET", url: `/v1/payment-links/${token}` });
const pay = (token: string) =>
  app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
const setStatus = (merchantId: string, status: string) =>
  pool.query(`UPDATE merchants SET status = $2 WHERE id = $1`, [merchantId, status]);

for (const status of ["suspended", "closed"] as const) {
  test(`a ${status} merchant's open link reads as unavailable, and paying it is refused`, async () => {
    const { merchantId, token } = await merchantWithLink();
    assert.equal((await read(token)).json().status, "active");

    await setStatus(merchantId, status);
    const res = await read(token);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "unavailable");

    const paid = await pay(token);
    assert.equal(paid.statusCode, 409, paid.body);
    assert.equal(paid.json().error, "merchant_unavailable");
  });
}

test("a paid link still reads as paid after the merchant is suspended (it is the customer's receipt)", async () => {
  const { merchantId, token } = await merchantWithLink();
  assert.equal((await pay(token)).statusCode, 200);
  await setStatus(merchantId, "suspended");
  assert.equal((await read(token)).json().status, "paid");
});

test("reactivating the merchant makes the link payable again", async () => {
  const { merchantId, token } = await merchantWithLink();
  await setStatus(merchantId, "suspended");
  assert.equal((await read(token)).json().status, "unavailable");
  await setStatus(merchantId, "active");
  assert.equal((await read(token)).json().status, "active");
  assert.equal((await pay(token)).statusCode, 200);
});
