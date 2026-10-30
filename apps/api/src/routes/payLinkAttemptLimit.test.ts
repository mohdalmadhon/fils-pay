/**
 * One payment link can't be used to test card numbers: after a few attempts
 * in the window it answers 429 (docs/defence/03).
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("payLinkAttemptLimit.test.ts requires DATABASE_URL");
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_MAX_ATTEMPTS: "3",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

async function link(): Promise<string> {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `Attempt limit ${randomUUID()}`,
  ]);
  await recordKycReview(pool, { merchantId: m.rows[0]!.id, outcome: "approved", reviewerIdentifier: "test" });
  const token = `plink_${randomUUID()}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, 1000, now() + interval '1 hour', 'merchant_api_key', $3)`,
    [m.rows[0]!.id, token, randomUUID()],
  );
  return token;
}

const pay = (token: string, pan: string) =>
  app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: { pan, expiryMonth: 12, expiryYear: 2030, cvv: "123" } },
  });

test("a link refuses card attempts past its allowance, and other links are unaffected", async () => {
  const tested = await link();
  for (let i = 0; i < 3; i++) {
    const r = await pay(tested, "4000000000000002"); // the simulator declines it
    assert.equal(r.statusCode, 402, r.body);
  }
  const blocked = await pay(tested, "4242424242424242");
  assert.equal(blocked.statusCode, 429, blocked.body);
  assert.equal(blocked.json().error, "too_many_payment_attempts");
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  const row = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [tested]);
  assert.equal(row.rows[0]!.status, "active", "nothing was charged");

  const other = await link();
  assert.equal((await pay(other, "4242424242424242")).statusCode, 200);
});
