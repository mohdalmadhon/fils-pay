/**
 * Regression tests: an admin key rotation must kill the old key.
 *
 * Rotation used to issue the replacement and leave the old key working
 * indefinitely, though the migration, the issuer and the route all described
 * it as "revoke + reissue".
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { createMerchant, signedInAdmin } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminApiKeyRotation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

function call(rawKey: string) {
  return app.inject({ method: "GET", url: "/v1/transactions", headers: { authorization: `Bearer ${rawKey}` } });
}

function rotate(cookie: string, merchantId: string, keyId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/api-keys/${keyId}/rotate`,
    headers: { cookie },
    payload: {},
  });
}

test("after a rotation the old key is refused and the new key works", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "rotation-revokes");
  const { merchantId, ownerUserId } = await createMerchant(pool, "rotation-revokes");
  const original = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label: "leaked" });
  assert.equal((await call(original.rawKey)).statusCode, 200);

  const res = await rotate(finance.cookie, merchantId, original.id);
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as { rawKey: string; previousKeyRevokedAt: string };
  assert.ok(!Number.isNaN(Date.parse(body.previousKeyRevokedAt)));

  assert.equal((await call(original.rawKey)).statusCode, 401, "the rotated-out key must not authenticate");
  assert.equal((await call(body.rawKey)).statusCode, 200);
});

test("a key can only be rotated once: a second rotation of the same key is a 409", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "rotation-twice");
  const { merchantId, ownerUserId } = await createMerchant(pool, "rotation-twice");
  const original = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId });

  assert.equal((await rotate(finance.cookie, merchantId, original.id)).statusCode, 201);
  assert.equal((await rotate(finance.cookie, merchantId, original.id)).statusCode, 409);

  const keys = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM api_keys WHERE merchant_id = $1 AND revoked_at IS NULL`,
    [merchantId],
  );
  assert.equal(keys.rows[0]!.n, 1, "exactly one live key remains");
});

test("two rotations of the same key at once leave one live replacement", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "rotation-race");
  const { merchantId, ownerUserId } = await createMerchant(pool, "rotation-race");
  const original = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId });

  const results = await Promise.all([
    rotate(finance.cookie, merchantId, original.id),
    rotate(finance.cookie, merchantId, original.id),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  const keys = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM api_keys WHERE merchant_id = $1 AND revoked_at IS NULL`,
    [merchantId],
  );
  assert.equal(keys.rows[0]!.n, 1);
});
