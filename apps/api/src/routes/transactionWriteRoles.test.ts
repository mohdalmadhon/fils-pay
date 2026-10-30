/**
 * Capture and void move money, so only owner and finance (and API keys,
 * which are owner-issued) may call them. The merchant "support" role and an
 * admin's view-only impersonation grant (support/finance admins) must get
 * 403.
 *
 * Before the fix both routes had only requireMerchantAuth: any merchant user
 * and any "view as merchant" session could capture or void.
 *
 * The role check runs before the handler, so an unknown transaction id is
 * enough: forbidden callers get 403, allowed callers get past the gate (404).
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
import { createMerchant, parseCookie, signedInAdmin, type AdminRole } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("transactionWriteRoles.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

const PASSWORD = "merchant role test password 1!";

async function merchantSession(role: "owner" | "finance" | "support") {
  const { merchantId } = await createMerchant(pool, `roles-${role}`);
  const email = `${role}-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, $3, $4)`,
    [merchantId, email, role, await hashPassword(PASSWORD, config)],
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
  return cookie;
}

async function impersonation(role: AdminRole) {
  const admin = await signedInAdmin(app, pool, config, role, `txn-roles-${role}`);
  const { merchantId } = await createMerchant(pool, `imp-${role}`);
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(res.statusCode, 201, res.body);
  return parseCookie(res.headers["set-cookie"], config.impersonationCookieName);
}

function write(cookie: string, action: "capture" | "void") {
  return app.inject({
    method: "POST",
    url: `/v1/transactions/${randomUUID()}/${action}`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: {},
  });
}

for (const action of ["capture", "void"] as const) {
  test(`${action}: a merchant support user is refused`, async () => {
    const res = await write(await merchantSession("support"), action);
    assert.equal(res.statusCode, 403, res.body);
  });

  test(`${action}: a support or finance admin viewing as the merchant is refused`, async () => {
    for (const role of ["support", "finance"] as const) {
      const res = await write(await impersonation(role), action);
      assert.equal(res.statusCode, 403, `${role}: ${res.body}`);
    }
  });

  test(`${action}: owner and finance users get past the role check`, async () => {
    for (const role of ["owner", "finance"] as const) {
      const res = await write(await merchantSession(role), action);
      assert.notEqual(res.statusCode, 403, `${role}: ${res.body}`);
      assert.notEqual(res.statusCode, 401, `${role}: ${res.body}`);
    }
  });
}
