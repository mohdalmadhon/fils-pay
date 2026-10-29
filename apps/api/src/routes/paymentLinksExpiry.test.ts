/**
 * Regression tests for "payment link paid after expiry".
 *
 * The public pay endpoint used to take the expiry reference time from the
 * request body's `submittedAt`, so any caller could pay an expired link by
 * sending a timestamp from before `expires_at`. Expiry is now judged only
 * against the server's (database's) clock; `submittedAt` is ignored.
 *
 * Requires `DATABASE_URL` pointing at a real, migrated Postgres.
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
  throw new Error("paymentLinksExpiry.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "60",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function createMerchantWithLink(label: string): Promise<{ merchantId: string; token: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Expiry ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label });

  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${key.rawKey}` },
    payload: { amountFils: 4_750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  return { merchantId, token: (created.json() as { token: string }).token };
}

async function expireLink(token: string): Promise<void> {
  await pool.query(`UPDATE payment_links SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);
}

function pay(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: APPROVED_CARD, ...body },
  });
}

async function transactionCount(merchantId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM transactions WHERE merchant_id = $1`,
    [merchantId],
  );
  return Number(result.rows[0]!.n);
}

test("expired link + a submittedAt from before expiry is still rejected 410 and charges nothing", async () => {
  const { merchantId, token } = await createMerchantWithLink("backdated");
  await expireLink(token);

  const read = await app.inject({ method: "GET", url: `/v1/payment-links/${token}` });
  assert.equal(read.json().status, "expired");

  const res = await pay(token, { submittedAt: new Date(Date.now() - 86_400_000).toISOString() });
  assert.equal(res.statusCode, 410, res.body);
  assert.equal(res.json().error, "payment_link_expired");
  assert.equal(await transactionCount(merchantId), 0, "no authorization or capture may happen");

  const link = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [token]);
  assert.equal(link.rows[0]!.status, "active", "an expired link is never reserved or paid");
});

test("expired link whose stale reservation lapsed is also rejected despite a backdated submittedAt", async () => {
  const { merchantId, token } = await createMerchantWithLink("stale-reserved");
  await pool.query(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now() - interval '10 minutes',
            expires_at = now() - interval '1 minute'
      WHERE token = $1`,
    [token],
  );
  const res = await pay(token, { submittedAt: "2000-01-01T00:00:00.000Z" });
  assert.equal(res.statusCode, 410, res.body);
  assert.equal(await transactionCount(merchantId), 0);
});

test("submittedAt is ignored, not rejected: an active link still pays with any submittedAt value", async () => {
  for (const submittedAt of ["2000-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z", "not-a-timestamp"]) {
    const { token } = await createMerchantWithLink(`ignored-${submittedAt}`);
    const res = await pay(token, { submittedAt });
    assert.equal(res.statusCode, 200, `${submittedAt}: ${res.body}`);
    assert.equal(res.json().status, "paid");
  }
});
