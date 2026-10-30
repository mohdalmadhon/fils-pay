/**
 * The account's login-failure limit also bounds one-time-code guesses
 * (docs/defence/01). Someone who has the password used to open many pending
 * sign-ins first, each with its own 5 guesses, and keep guessing on the
 * older ones after the account had hit its limit.
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
import { hashPassword as hashAdminPassword } from "../adminAuth/passwords.js";
import { recordKycReview } from "../onboarding/review.js";
import { createMerchant, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("otpGuessBudget.test.ts requires DATABASE_URL");
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  LOGIN_MAX_FAILURES: "10",
  OTP_MAX_ATTEMPTS: "5",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

const PASSWORD = "otp guess budget test 1!";

async function merchantUser() {
  const { merchantId } = await createMerchant(pool, "otp-budget");
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const email = `otp-${randomUUID()}@example.test`;
  await pool.query(`INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`, [
    merchantId,
    email,
    await hashPassword(PASSWORD, config),
  ]);
  return { merchantId, email };
}

async function login(u: { merchantId: string; email: string }) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { ...u, password: PASSWORD } });
  assert.equal(res.statusCode, 200, res.body);
  return { cookie: parseCookie(res.headers["set-cookie"], config.cookieName), code: (res.json() as { devOtpCode: string }).devOtpCode };
}

const verify = (cookie: string, code: string) =>
  app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });

test("a new sign-in ends the user's earlier pending sign-ins", async () => {
  const u = await merchantUser();
  const first = await login(u);
  const second = await login(u);
  const old = await verify(first.cookie, first.code);
  assert.equal(old.statusCode, 401, old.body);
  assert.equal(old.json().error, "no_pending_session");
  assert.equal((await verify(second.cookie, second.code)).statusCode, 200);
});

test("once the account is over its failure limit, no pending sign-in accepts a code, even the right one", async () => {
  const u = await merchantUser();
  const live = await login(u);
  for (let i = 0; i < 4; i++) assert.equal((await verify(live.cookie, "000000")).statusCode, 401);
  // Six more failures for this account (wrong passwords) reach the limit of 10.
  for (let i = 0; i < 6; i++) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { ...u, password: "wrong password 1!" } });
    assert.equal(r.statusCode, 401, r.body);
  }
  const res = await verify(live.cookie, live.code);
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().error, "too_many_login_attempts");
});

test("admin plane: a new sign-in ends the earlier pending one, and the limit applies to codes", async () => {
  const email = `otp-admin-${randomUUID()}@admin.test`;
  await pool.query(`INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'OTP Budget', 'finance')`, [
    email,
    await hashAdminPassword(PASSWORD, config),
  ]);
  const adminLogin = async () => {
    const r = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
    assert.equal(r.statusCode, 200, r.body);
    return { cookie: parseCookie(r.headers["set-cookie"], config.adminCookieName), code: (r.json() as { devOtpCode: string }).devOtpCode };
  };
  const adminVerify = (cookie: string, code: string) =>
    app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie }, payload: { code } });
  const first = await adminLogin();
  const second = await adminLogin();
  assert.equal((await adminVerify(first.cookie, first.code)).statusCode, 401);
  for (let i = 0; i < 4; i++) assert.equal((await adminVerify(second.cookie, "000000")).statusCode, 401);
  for (let i = 0; i < 6; i++) {
    await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: "wrong password 1!" } });
  }
  assert.equal((await adminVerify(second.cookie, second.code)).statusCode, 429);
});
