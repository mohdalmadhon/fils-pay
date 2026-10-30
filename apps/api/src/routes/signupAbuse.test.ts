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

function signupWith(email: string, profile: Record<string, unknown>) {
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
        ...profile,
      },
      owner: { email, password: "a perfectly fine password 1!" },
    },
  });
}

test("bad signup fields are a 400 before anything is reserved, and don't use up the quota", async () => {
  const email = `fields-${randomUUID()}@example.test`;
  const bad: Array<Record<string, unknown>> = [
    { businessType: "corporation" },
    { country: "BHR" },
    { country: 12 },
    { city: null },
    { legalName: 42 },
    { contactEmail: "not an email" },
    { addressLine2: { line: 2 } },
  ];
  for (const profile of bad) {
    const res = await signupWith(email, profile);
    assert.equal(res.statusCode, 400, `${JSON.stringify(profile)}: ${res.body}`);
  }
  const badOwnerEmail = await signupWith("nope", {});
  assert.equal(badOwnerEmail.statusCode, 400, badOwnerEmail.body);

  // None of the failures above counted: all three real signups still fit.
  for (let i = 0; i < 3; i += 1) {
    const ok = await signupWith(i === 0 ? `  ${email}  ` : email, { country: "bh" });
    assert.equal(ok.statusCode, 201, `signup ${i + 1}: ${ok.body}`);
  }
  const stored = await pool.query<{ email: string }>(
    `SELECT DISTINCT email FROM merchant_users WHERE email ILIKE $1`,
    [`%${email}%`],
  );
  assert.deepEqual(stored.rows.map((r) => r.email), [email], "the owner email is stored trimmed");
});

test("PATCH business-profile: bad businessType, country or a null required field is a 400", async () => {
  const email = `patch-${randomUUID()}@example.test`;
  const password = "a perfectly fine password 1!";
  const res = await signupWith(email, {});
  assert.equal(res.statusCode, 201, res.body);
  const { merchantId } = res.json() as { merchantId: string };
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: parseCookie(login.headers["set-cookie"], config.cookieName) },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = (([] as string[]).concat(verify.headers["set-cookie"] ?? [])[0] ?? "").split(";")[0]!;

  for (const patch of [{ businessType: "corporation" }, { country: "BHR" }, { city: null }, { contactEmail: "x" }]) {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/merchants/${merchantId}/business-profile`,
      headers: { cookie },
      payload: patch,
    });
    assert.equal(r.statusCode, 400, `${JSON.stringify(patch)}: ${r.body}`);
  }
  const ok = await app.inject({
    method: "PATCH",
    url: `/v1/merchants/${merchantId}/business-profile`,
    headers: { cookie },
    payload: { country: "sa", postalCode: null, city: " Riyadh " },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().country, "SA");
  assert.equal(ok.json().city, "Riyadh");
});
