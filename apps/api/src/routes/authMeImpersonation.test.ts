/**
 * GET /v1/auth/me with an admin's "view as merchant" grant.
 *
 * The admin console opens the merchant dashboard with only the grant
 * cookie. The dashboard decides "am I signed in" from /v1/auth/me, which
 * used to read only fp_sid, so it answered 401 and the operator landed on
 * the merchant login page.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createMerchant, parseCookie, signedInAdmin } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("authMeImpersonation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

test("GET /v1/auth/me accepts a view-as-merchant grant cookie alone", async () => {
  const admin = await signedInAdmin(app, pool, config, "support", "me-grant");
  const { merchantId } = await createMerchant(pool, "me-grant");
  const start = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(start.statusCode, 201, start.body);
  const grantCookie = parseCookie(start.headers["set-cookie"], config.impersonationCookieName);
  const grantId = (start.json() as { grantId: string }).grantId;

  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: grantCookie } });
  assert.equal(me.statusCode, 200, me.body);
  const body = me.json() as {
    merchantUserId: string | null;
    email: string | null;
    role: string;
    merchant: { id: string };
    impersonation?: { grantId: string; readOnly: boolean };
  };
  assert.equal(body.merchant.id, merchantId);
  assert.equal(body.role, "support");
  assert.equal(body.merchantUserId, null);
  assert.equal(body.email, null);
  assert.deepEqual(body.impersonation, { grantId, readOnly: true });
});

test("GET /v1/auth/me with no cookie, or an unknown grant, is still 401", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me" })).statusCode, 401);
  const bogus = `${config.impersonationCookieName}=not-a-real-grant`;
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: bogus } })).statusCode, 401);
});
