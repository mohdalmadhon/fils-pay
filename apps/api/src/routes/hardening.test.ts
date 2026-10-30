/**
 * Small hardening checks, each a gap the review found:
 *  - CSV export: a reference starting with = + - @ (or tab/CR) must not be
 *    read as a formula by Excel or Sheets (CSV/formula injection);
 *  - security headers on every response, and no caching of API responses;
 *  - crafted input gets a 400, not a 500: unknown business-profile fields,
 *    a non-numeric ?limit.
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
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { createMerchant, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("hardening.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CR/LF inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function merchantWithKey() {
  const { merchantId, ownerUserId } = await createMerchant(pool, "hardening");
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label: "hardening" });
  return { merchantId, headers: { authorization: `Bearer ${key.rawKey}` } };
}

test("CSV export neutralises formula-looking references", async () => {
  const m = await merchantWithKey();
  const references = ['=HYPERLINK("http://evil.example","x")', "+1+1", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"];
  for (const reference of references) {
    await pool.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference, occurred_at)
       VALUES ($1, 'authorized', 1000, 0, $2, $3, now())`,
      [m.merchantId, reference, `acq_${randomUUID()}`],
    );
  }
  const res = await app.inject({ method: "GET", url: "/v1/transactions/export", headers: m.headers });
  assert.equal(res.statusCode, 200, res.body);
  const rows = parseCsv(res.body).slice(1).filter((r) => r.length > 1);
  assert.equal(rows.length, references.length);
  for (const row of rows) {
    const ref = row[4]!;
    assert.ok(!/^[=+\-@\t\r]/.test(ref), `formula-looking cell: ${JSON.stringify(ref)}`);
    assert.ok(references.includes(ref.slice(1)), `value kept after the quote prefix: ${JSON.stringify(ref)}`);
  }
});

test("every response carries the basic security headers, and API responses aren't cached", async () => {
  for (const url of ["/health", "/v1/auth/me", "/v1/payment-links/does-not-exist"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.headers["x-content-type-options"], "nosniff", url);
    assert.equal(res.headers["x-frame-options"], "DENY", url);
    assert.equal(res.headers["referrer-policy"], "no-referrer", url);
    if (url.startsWith("/v1/")) assert.equal(res.headers["cache-control"], "no-store", url);
  }
});

test("a non-numeric ?limit is a 400, not a 500", async () => {
  const m = await merchantWithKey();
  const res = await app.inject({ method: "GET", url: "/v1/transactions?limit=abc", headers: m.headers });
  assert.equal(res.statusCode, 400, res.body);
});

test("an unknown business-profile field is a 400, not a 500", async () => {
  const { merchantId } = await createMerchant(pool, "hardening-bp");
  const email = `bp-${randomUUID()}@example.test`;
  const password = "hardening password 1!";
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(password, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  const cookie = parseCookie(login.headers["set-cookie"], config.cookieName);
  await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/merchants/${merchantId}/business-profile`,
    headers: { cookie },
    payload: { status: "approved" },
  });
  assert.equal(res.statusCode, 400, res.body);
});
