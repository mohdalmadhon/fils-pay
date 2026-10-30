/**
 * POST /v1/reporting/saved-filters is a write: owner and finance only, never
 * a view-only "view as merchant" session, and at most 50 per merchant.
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
  throw new Error("reportingSavedFilters.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

const PASSWORD = "saved filter test password 1!";

async function merchantSession(role: "owner" | "finance" | "support") {
  const { merchantId } = await createMerchant(pool, `saved-filters-${role}`);
  const email = `${role}-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, $3, $4)`,
    [merchantId, email, role, await hashPassword(PASSWORD, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const pending = parseCookie(login.headers["set-cookie"], config.cookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: pending },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = (([] as string[]).concat(verify.headers["set-cookie"] ?? [])[0] ?? "").split(";")[0]!;
  return { merchantId, cookie };
}

async function impersonation(role: AdminRole) {
  const admin = await signedInAdmin(app, pool, config, role, `saved-filters-${role}`);
  const { merchantId } = await createMerchant(pool, `saved-filters-imp-${role}`);
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { merchantId, cookie: parseCookie(res.headers["set-cookie"], config.impersonationCookieName) };
}

function save(cookie: string, name = "mine") {
  return app.inject({
    method: "POST",
    url: "/v1/reporting/saved-filters",
    headers: { cookie },
    payload: { name, filter: { status: "captured" } },
  });
}

async function savedCount(merchantId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reporting_saved_filters WHERE merchant_id = $1`,
    [merchantId],
  );
  return r.rows[0]!.n;
}

test("saved filters: a merchant support user and a view-only admin session can't save", async () => {
  const support = await merchantSession("support");
  const res = await save(support.cookie);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(await savedCount(support.merchantId), 0);

  for (const role of ["support", "finance"] as const) {
    const viewer = await impersonation(role);
    const r = await save(viewer.cookie);
    assert.equal(r.statusCode, 403, `${role}: ${r.body}`);
    assert.equal(await savedCount(viewer.merchantId), 0);
  }
});

test("saved filters: owner and finance can save, up to 50 per merchant", async () => {
  const finance = await merchantSession("finance");
  assert.equal((await save(finance.cookie)).statusCode, 201);

  const owner = await merchantSession("owner");
  for (let i = 0; i < 50; i++) {
    const r = await save(owner.cookie, `f${i}`);
    assert.equal(r.statusCode, 201, r.body);
  }
  const over = await save(owner.cookie, "one too many");
  assert.equal(over.statusCode, 409, over.body);
  assert.equal(over.json().error, "saved_filter_limit_reached");
  assert.equal(await savedCount(owner.merchantId), 50);
});
