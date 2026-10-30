/**
 * Signup abuse limits and email ownership (docs/improvements/11).
 *
 * Before the fix: POST /v1/merchants accepted any password (one character, or
 * a megabyte that argon2 then hashed), had no limit on how many merchants one
 * email could open, and recorded nothing about whether the owner had ever
 * proved they control the email.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("signupAbuse.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

function signup(email: string, password = "a perfectly fine password 1!") {
  return app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Signup Co ${randomUUID().slice(0, 6)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `c-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
}

test("passwords shorter than 12 or longer than 256 characters are refused", async () => {
  const email = `pw-${randomUUID()}@example.test`;
  assert.equal((await signup(email, "short1!")).statusCode, 400);
  assert.equal((await signup(email, "x".repeat(257))).statusCode, 400);
  assert.equal((await signup(email, "twelve chars")).statusCode, 201);
});

test("one email can open at most 3 merchants an hour", async () => {
  const email = `many-${randomUUID()}@example.test`;
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await signup(email)).statusCode, 201, `signup ${i + 1}`);
  }
  const fourth = await signup(email.toUpperCase());
  assert.equal(fourth.statusCode, 429, fourth.body);
  // Someone else is unaffected.
  assert.equal((await signup(`other-${randomUUID()}@example.test`)).statusCode, 201);
});

test("the owner's email counts as verified only once they finish an OTP login", async () => {
  const email = `verify-${randomUUID()}@example.test`;
  const password = "a perfectly fine password 1!";
  const res = await signup(email, password);
  const { merchantId, ownerUserId } = res.json() as { merchantId: string; ownerUserId: string };
  const verifiedAt = async () =>
    (await pool.query<{ email_verified_at: Date | null }>(`SELECT email_verified_at FROM merchant_users WHERE id = $1`, [ownerUserId]))
      .rows[0]!.email_verified_at;
  assert.equal(await verifiedAt(), null, "not verified at signup");

  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: parseCookie(login.headers["set-cookie"], config.cookieName) },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.ok(await verifiedAt(), "verified after the first OTP login (the code went to that address)");
});
