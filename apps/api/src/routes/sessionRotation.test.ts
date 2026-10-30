/**
 * Session tokens after OTP, and impersonation after admin logout.
 *
 *  - Completing OTP must issue a new session token. Before the fix the
 *    pending token (set at /login, before the second factor) simply became
 *    the full session, so a pending token that leaked before OTP turned into
 *    a full session once the real user finished OTP. The merchant cookie
 *    also kept the 10-minute pending lifetime (the "10 min logouts").
 *  - Admin logout must end that admin's "view as merchant" grants. Before,
 *    a grant cookie kept working for up to 15 minutes after logout.
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
import { createMerchant, parseCookie, signedInAdmin, createAdminUser, ADMIN_PASSWORD } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("sessionRotation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

function maxAgeOf(header: string | string[] | undefined, name: string): number | null {
  const all = Array.isArray(header) ? header : header ? [header] : [];
  const line = all.find((h) => h.startsWith(`${name}=`));
  const m = line && /Max-Age=(\d+)/i.exec(line);
  return m ? Number(m[1]) : null;
}

test("merchant: OTP verify issues a new token and the pending one stops working", async () => {
  const { merchantId } = await createMerchant(pool, "rotate");
  const email = `rotate-${randomUUID()}@example.test`;
  const password = "rotation test password 1!";
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(password, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  const pendingCookie = parseCookie(login.headers["set-cookie"], config.cookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: pendingCookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const fullCookie = parseCookie(verify.headers["set-cookie"], config.cookieName);

  assert.notEqual(fullCookie, pendingCookie, "a new token after OTP");
  assert.equal(maxAgeOf(verify.headers["set-cookie"], config.cookieName), config.sessionTtlHours * 3600);
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: fullCookie } })).statusCode, 200);
  assert.equal(
    (await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: pendingCookie } })).statusCode,
    401,
    "the pre-OTP token must not be a session",
  );
});

test("admin: OTP verify issues a new token and the pending one stops working", async () => {
  const admin = await createAdminUser(pool, config, "support", "rotate");
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: ADMIN_PASSWORD } });
  const pendingCookie = parseCookie(login.headers["set-cookie"], config.adminCookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie: pendingCookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const fullCookie = parseCookie(verify.headers["set-cookie"], config.adminCookieName);
  assert.notEqual(fullCookie, pendingCookie);
  assert.equal((await app.inject({ method: "GET", url: "/v1/admin/auth/me", headers: { cookie: fullCookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/v1/admin/auth/me", headers: { cookie: pendingCookie } })).statusCode, 401);
});

test("admin logout ends that admin's view-as-merchant grants", async () => {
  const admin = await signedInAdmin(app, pool, config, "support", "logout-grant");
  const { merchantId } = await createMerchant(pool, "logout-grant");
  const start = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(start.statusCode, 201, start.body);
  const grantCookie = parseCookie(start.headers["set-cookie"], config.impersonationCookieName);
  const viewTxns = () => app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: grantCookie } });
  assert.equal((await viewTxns()).statusCode, 200);

  const logout = await app.inject({ method: "POST", url: "/v1/admin/auth/logout", headers: { cookie: admin.cookie } });
  assert.ok(logout.statusCode < 300, logout.body);
  assert.equal((await viewTxns()).statusCode, 401, "grant must stop working at logout");
});

test("admin logout closes each live view-as grant like ending it: ended_at set and an impersonation_end audit row", async () => {
  const admin = await signedInAdmin(app, pool, config, "support", "logout-audit");
  const grantIds: string[] = [];
  for (const label of ["logout-audit-a", "logout-audit-b"]) {
    const { merchantId } = await createMerchant(pool, label);
    const start = await app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/impersonate`,
      headers: { cookie: admin.cookie },
    });
    assert.equal(start.statusCode, 201, start.body);
    grantIds.push((start.json() as { grantId: string }).grantId);
  }

  const logout = await app.inject({ method: "POST", url: "/v1/admin/auth/logout", headers: { cookie: admin.cookie } });
  assert.equal(logout.statusCode, 204, logout.body);

  const grants = await pool.query<{ id: string; ended_at: Date | null }>(
    `SELECT id, ended_at FROM admin_impersonation_grants WHERE admin_user_id = $1`,
    [admin.id],
  );
  assert.equal(grants.rowCount, 2);
  for (const g of grants.rows) assert.ok(g.ended_at, `grant ${g.id} has ended_at`);

  const audit = await pool.query<{ metadata: { grantId: string; reason?: string } }>(
    `SELECT metadata FROM admin_audit_log WHERE admin_user_id = $1 AND action = 'impersonation_end'`,
    [admin.id],
  );
  assert.deepEqual(audit.rows.map((r) => r.metadata.grantId).sort(), [...grantIds].sort());
  for (const r of audit.rows) assert.equal(r.metadata.reason, "logout");
});
