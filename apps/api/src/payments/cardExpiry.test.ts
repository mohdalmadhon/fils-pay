/**
 * Expired cards are refused before the acquirer is asked: POST
 * /v1/transactions and the hosted checkout (POST /v1/payment-links/:token/pay)
 * both answer 422 card_expired. Before, the simulator approved any expiry.
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
import { isCardExpired } from "./authorize.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("cardExpiry.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function approvedMerchantWithKey(label: string) {
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `Expiry ${label} ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const ownerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    )
  ).rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label });
  return { merchantId, rawKey: issued.rawKey };
}

const lastYear = new Date().getUTCFullYear() - 1;
const EXPIRED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: lastYear, cvv: "123" };

test("isCardExpired: valid through the end of the expiry month, in Bahrain time", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  assert.equal(isCardExpired({ expiryMonth: 9, expiryYear: 2026 }, now), true);
  assert.equal(isCardExpired({ expiryMonth: 10, expiryYear: 2026 }, now), false);
  assert.equal(isCardExpired({ expiryMonth: 1, expiryYear: 2027 }, now), false);
  assert.equal(isCardExpired({ expiryMonth: 12, expiryYear: 2025 }, now), true);
  assert.equal(isCardExpired({ expiryMonth: 9, expiryYear: 26 }, now), true, "two-digit year is 20YY");
  // 22:00 UTC on 31 Oct is already 1 Nov in Bahrain: an October card has expired.
  assert.equal(isCardExpired({ expiryMonth: 10, expiryYear: 2026 }, new Date("2026-10-31T22:00:00.000Z")), true);
});

test("POST /v1/transactions refuses an expired card with 422 card_expired", async () => {
  const { rawKey } = await approvedMerchantWithKey("api");
  const res = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 5_000, card: EXPIRED_CARD, reference: "expired-card" },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal((res.json() as { error: string }).error, "card_expired");
});

test("paying a payment link with an expired card is refused and the link stays payable", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("link");
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 5_000, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const { token, id } = created.json() as { token: string; id: string };

  const pay = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: EXPIRED_CARD },
  });
  assert.equal(pay.statusCode, 422, pay.body);
  assert.equal((pay.json() as { error: string }).error, "card_expired");
  const status = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [id]);
  assert.equal(status.rows[0]!.status, "active");
});
