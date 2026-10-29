/**
 * Regression tests: "Recompute transaction statuses" must never switch a test
 * merchant to live.
 *
 * The route used to clear merchants.test_mode whenever it counted no open
 * authorizations, and that count was always 0. The settlement service only
 * skips test_mode merchants, so the merchant's test transactions were then
 * settled and paid out.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createMerchant, signedInAdmin } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminRecomputeTestMode.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function addTransaction(merchantId: string, status: string, amount: number, captured: number, refunded = 0) {
  await pool.query(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [merchantId, status, amount, captured, refunded, `acq_${randomUUID()}`],
  );
}

async function recompute(cookie: string, merchantId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/transactions/recompute-statuses`,
    headers: { cookie },
  });
}

async function testMode(merchantId: string): Promise<boolean> {
  const r = await pool.query<{ test_mode: boolean }>(`SELECT test_mode FROM merchants WHERE id = $1`, [merchantId]);
  return r.rows[0]!.test_mode;
}

test("a test merchant stays in test mode after a status recompute", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "recompute-testmode");
  const { merchantId } = await createMerchant(pool, "sandbox", { testMode: true });
  // Captured, partially refunded but mislabelled: exactly what the tool tidies.
  await addTransaction(merchantId, "captured", 10_000, 10_000, 4_000);
  await addTransaction(merchantId, "captured", 5_000, 5_000);

  const res = await recompute(finance.cookie, merchantId);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { updated: number; flagsUpdated: string[] };
  assert.equal(body.updated, 1, "the mislabelled transaction is still corrected");
  assert.deepEqual(body.flagsUpdated, []);
  assert.equal(await testMode(merchantId), true, "test_mode must not be cleared by a status recompute");

  const audit = await pool.query<{ metadata: { flagsUpdated: string[] } }>(
    `SELECT metadata FROM admin_audit_log WHERE action = 'transaction_status_recompute' AND target_id = $1`,
    [merchantId],
  );
  assert.deepEqual(audit.rows[0]!.metadata.flagsUpdated, []);
});

test("open authorizations are counted", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "recompute-openauth");
  const { merchantId } = await createMerchant(pool, "openauth");
  await addTransaction(merchantId, "authorized", 3_000, 0);
  await addTransaction(merchantId, "authorized", 2_000, 0);
  await addTransaction(merchantId, "captured", 5_000, 5_000);

  const res = await recompute(finance.cookie, merchantId);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { openAuthorizations: number }).openAuthorizations, 2);
});

test("a live merchant stays live", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "recompute-live");
  const { merchantId } = await createMerchant(pool, "live");
  await addTransaction(merchantId, "captured", 5_000, 5_000);
  assert.equal((await recompute(finance.cookie, merchantId)).statusCode, 200);
  assert.equal(await testMode(merchantId), false);
});
