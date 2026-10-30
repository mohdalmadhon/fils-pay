/**
 * Regression test: merchant login must bind the OTP challenge and session to
 * the merchant user whose password was checked.
 *
 * Before the fix, /v1/auth/login checked the password of the user in the
 * requested merchant, then looked the email up again across *all* merchants
 * (findOtpRecipient, no merchant filter, LIMIT 1) and issued the challenge and
 * session for whichever row came back. Emails are only unique per merchant
 * and signup is public, so anyone could sign up a merchant with a victim's
 * email, log in with their own password, and receive the victim's session.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("loginTenantBinding.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function signup(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Tenant Co ${randomUUID().slice(0, 6)}`,
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
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { merchantId: string }).merchantId;
}

async function loginAndVerify(merchantId: string, email: string, password: string) {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const header = login.headers["set-cookie"];
  let cookie = (Array.isArray(header) ? header[0]! : header!).split(";")[0]!;
  const { devOtpCode } = login.json() as { devOtpCode: string };
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: devOtpCode } });
  assert.equal(verify.statusCode, 200, verify.body);
  // OTP verify issues a new session token; the pending one is dead.
  cookie = (([] as string[]).concat(verify.headers["set-cookie"] ?? [])[0] ?? "").split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  return me.json() as { merchant: { id: string } };
}

test("login with your own password never yields a session in another merchant that shares the email", async () => {
  const sharedEmail = `owner-${randomUUID()}@example.test`;
  const victimMerchant = await signup(sharedEmail, "victim's own password 1!");
  const attackerMerchant = await signup(sharedEmail, "attacker's own password 1!");

  const me = await loginAndVerify(attackerMerchant, sharedEmail, "attacker's own password 1!");
  assert.equal(me.merchant.id, attackerMerchant, "the session must belong to the merchant whose password was checked");
  assert.notEqual(me.merchant.id, victimMerchant);
});

test("the legitimate owner still lands in their own merchant", async () => {
  const sharedEmail = `owner-${randomUUID()}@example.test`;
  const first = await signup(sharedEmail, "first owner password 1!");
  const second = await signup(sharedEmail, "second owner password 1!");

  assert.equal((await loginAndVerify(first, sharedEmail, "first owner password 1!")).merchant.id, first);
  assert.equal((await loginAndVerify(second, sharedEmail, "second owner password 1!")).merchant.id, second);
});
