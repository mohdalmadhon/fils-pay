/**
 * Login throttling, merchant and admin.
 *
 * Before the fix nothing limited /login: passwords could be guessed without
 * limit, and every fresh login handed out a new OTP challenge with 5 new
 * guesses, so a 6-digit code fell to enough scripted logins.
 *
 * After LOGIN_MAX_FAILURES failed password or OTP attempts for one account
 * within LOGIN_FAILURE_WINDOW_MINUTES, login for that account answers 429
 * (even with the right password) until the window passes.
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
import { createAdminUser, ADMIN_PASSWORD, createMerchant, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("loginThrottle.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  LOGIN_MAX_FAILURES: "4",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const PASSWORD = "throttle test password 1!";

async function merchantUser() {
  const { merchantId } = await createMerchant(pool, "throttle");
  const email = `throttle-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(PASSWORD, config)],
  );
  return { merchantId, email };
}

const merchantLogin = (u: { merchantId: string; email: string }, password: string) =>
  app.inject({ method: "POST", url: "/v1/auth/login", payload: { ...u, password } });

test("merchant: after too many wrong passwords, even the right one is refused with 429", async () => {
  const u = await merchantUser();
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await merchantLogin(u, "wrong password")).statusCode, 401);
  }
  const blocked = await merchantLogin(u, PASSWORD);
  assert.equal(blocked.statusCode, 429, blocked.body);
  assert.equal((blocked.json() as { error: string }).error, "too_many_login_attempts");
});

test("merchant: wrong OTP codes across fresh logins count toward the same limit", async () => {
  const u = await merchantUser();
  for (let i = 0; i < 4; i += 1) {
    const login = await merchantLogin(u, PASSWORD);
    assert.equal(login.statusCode, 200, login.body);
    const cookie = parseCookie(login.headers["set-cookie"], config.cookieName);
    const real = (login.json() as { devOtpCode: string }).devOtpCode;
    const wrong = real.split("").map((d) => String((Number(d) + 1) % 10)).join("");
    const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong } });
    assert.equal(verify.statusCode, 401, verify.body);
  }
  assert.equal((await merchantLogin(u, PASSWORD)).statusCode, 429);
});

test("merchant: an unknown account is throttled the same way (no enumeration through the limit)", async () => {
  const ghost = { merchantId: randomUUID(), email: `ghost-${randomUUID()}@example.test` };
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await merchantLogin(ghost, "x")).statusCode, 401);
  }
  assert.equal((await merchantLogin(ghost, "x")).statusCode, 429);
});

test("merchant: one account's failures don't lock out another account", async () => {
  const a = await merchantUser();
  const b = await merchantUser();
  for (let i = 0; i < 5; i += 1) await merchantLogin(a, "wrong password");
  assert.equal((await merchantLogin(b, PASSWORD)).statusCode, 200);
});

test("admin: after too many wrong passwords, even the right one is refused with 429", async () => {
  const admin = await createAdminUser(pool, config, "support", "throttle");
  const login = (password: string) =>
    app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password } });
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await login("wrong password")).statusCode, 401);
  }
  assert.equal((await login(ADMIN_PASSWORD)).statusCode, 429);
});
