/**
 * Regression tests for OTP login safety (merchant and admin).
 *
 * Before the fix: codes came from Math.random(); the attempt limit was a
 * read-then-increment, so guesses sent in parallel were all checked; a
 * correct code could be used by two requests at once; and every resend
 * handed out a fresh set of guesses.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { generateOtpCode } from "../auth/otp.js";
import { randomFromAlphabet } from "../lib/random.js";
import { createAdminUser, ADMIN_PASSWORD, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("otpSafety.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

/** A wrong code that is guaranteed to differ from `real`. */
function wrongCode(real: string): string {
  return real.split("").map((d) => String((Number(d) + 1) % 10)).join("");
}

async function pendingMerchantLogin() {
  const email = `otp-${randomUUID()}@example.test`;
  const password = "correct horse battery staple 1!";
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `OTP Co ${randomUUID().slice(0, 6)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `contact-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const { merchantId } = signup.json() as { merchantId: string };
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const header = login.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0]! : header!).split(";")[0]!;
  return { cookie, code: (login.json() as { devOtpCode: string }).devOtpCode };
}

async function pendingAdminLogin() {
  const admin = await createAdminUser(pool, config, "support", "otp-safety");
  const login = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email: admin.email, password: ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200, login.body);
  return {
    cookie: parseCookie(login.headers["set-cookie"], config.adminCookieName),
    code: (login.json() as { devOtpCode: string }).devOtpCode,
  };
}

function verify(path: string, cookie: string, code: string) {
  return app.inject({ method: "POST", url: path, headers: { cookie }, payload: { code } });
}

test("OTP codes do not come from Math.random", () => {
  const original = Math.random;
  Math.random = () => 0; // the old generator then always produced "000000"
  try {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode(6)));
    assert.ok(codes.size > 40, `codes must stay unpredictable when Math.random is fixed, got ${codes.size} distinct`);
    const tokens = new Set(Array.from({ length: 20 }, () => randomFromAlphabet("abcdefghijklmnopqrstuvwxyz", 22)));
    assert.equal(tokens.size, 20, "payment link tokens must not come from Math.random either");
  } finally {
    Math.random = original;
  }
  for (const c of Array.from({ length: 200 }, () => generateOtpCode(6))) {
    assert.match(c, /^\d{6}$/);
  }
});

for (const plane of [
  { name: "merchant", path: "/v1/auth/otp/verify", pending: pendingMerchantLogin },
  { name: "admin", path: "/v1/admin/auth/otp/verify", pending: pendingAdminLogin },
] as const) {
  test(`${plane.name}: 30 guesses sent at once get at most ${config.otpMaxAttempts} code checks`, async () => {
    const { cookie, code } = await plane.pending();
    const bad = wrongCode(code);
    const results = await Promise.all(Array.from({ length: 30 }, () => verify(plane.path, cookie, bad)));
    const checked = results.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
    assert.ok(
      checked <= config.otpMaxAttempts,
      `only ${config.otpMaxAttempts} guesses may be checked, ${checked} were`,
    );
    // The budget is spent: even the right code is refused now.
    const after = await verify(plane.path, cookie, code);
    assert.notEqual(after.statusCode, 200, after.body);
  });

  test(`${plane.name}: one correct code used by two requests at once logs in once`, async () => {
    const { cookie, code } = await plane.pending();
    const results = await Promise.all([verify(plane.path, cookie, code), verify(plane.path, cookie, code)]);
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1, results.map((r) => r.body).join(" | "));
  });

  test(`${plane.name}: the right code still works after a few wrong ones`, async () => {
    const { cookie, code } = await plane.pending();
    const bad = wrongCode(code);
    for (let i = 0; i < config.otpMaxAttempts - 1; i++) {
      assert.equal((await verify(plane.path, cookie, bad)).statusCode, 401);
    }
    assert.equal((await verify(plane.path, cookie, code)).statusCode, 200);
  });
}

test("merchant: a resend does not hand out a fresh set of guesses", async () => {
  const { cookie, code } = await pendingMerchantLogin();
  const bad = wrongCode(code);
  for (let i = 0; i < config.otpMaxAttempts - 1; i++) {
    assert.equal((await verify("/v1/auth/otp/verify", cookie, bad)).statusCode, 401);
  }
  // Age the challenge past the 30 s resend throttle.
  await pool.query(
    `UPDATE otp_challenges SET created_at = now() - interval '1 minute'
      WHERE id = (SELECT otp_challenge_id FROM sessions WHERE token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex'))`,
    [cookie.slice(cookie.indexOf("=") + 1)],
  );
  const resend = await app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie } });
  assert.equal(resend.statusCode, 200, resend.body);
  const newCode = (resend.json() as { devOtpCode: string }).devOtpCode;
  const newBad = wrongCode(newCode);

  assert.equal((await verify("/v1/auth/otp/verify", cookie, newBad)).statusCode, 401, "the last remaining guess");
  const over = await verify("/v1/auth/otp/verify", cookie, newCode);
  assert.equal(over.statusCode, 429, `the budget carries over across a resend: ${over.body}`);
});
