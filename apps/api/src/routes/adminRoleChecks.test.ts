/**
 * Regression tests for admin role checks.
 *
 *  - Viewing as a merchant: only super_admin may make changes (ADMIN.md).
 *    A finance admin used to get the merchant "finance" role and could write.
 *  - A disabled admin's impersonation grant used to keep working until it
 *    expired; the "admin-disable trigger" a comment relied on doesn't exist.
 *  - Two-person credit approval compared display names instead of admin ids.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { assertDistinctApprover } from "../admin/creditApproval.js";
import { createMerchant, parseCookie, signedInAdmin, type AdminRole } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminRoleChecks.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function impersonate(role: AdminRole, label: string) {
  const admin = await signedInAdmin(app, pool, config, role, label);
  const { merchantId } = await createMerchant(pool, label);
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { admin, merchantId, impCookie: parseCookie(res.headers["set-cookie"], config.impersonationCookieName) };
}

function createEndpoint(impCookie: string, merchantId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/webhook-endpoints`,
    headers: { cookie: impCookie },
    payload: { url: `https://hooks.example.test/${randomUUID()}` },
  });
}

function createLink(impCookie: string, merchantId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { cookie: impCookie },
    payload: { amountFils: 1000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
}

test("a finance admin viewing as a merchant can read but not write", async () => {
  const { merchantId, impCookie } = await impersonate("finance", "imp-finance");
  const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(read.statusCode, 200, read.body);

  const endpoint = await createEndpoint(impCookie, merchantId);
  assert.equal(endpoint.statusCode, 403, `finance must not create webhook endpoints as the merchant: ${endpoint.body}`);
  const link = await createLink(impCookie, merchantId);
  assert.equal(link.statusCode, 403, `finance must not create payment links as the merchant: ${link.body}`);
});

test("a super_admin viewing as a merchant can still make changes", async () => {
  const { merchantId, impCookie } = await impersonate("super_admin", "imp-super");
  const endpoint = await createEndpoint(impCookie, merchantId);
  assert.equal(endpoint.statusCode, 201, endpoint.body);
});

test("disabling an admin kills their live impersonation grant", async () => {
  const { admin, impCookie } = await impersonate("support", "imp-disabled");
  const before = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(before.statusCode, 200, before.body);

  await pool.query(`UPDATE admin_users SET status = 'disabled' WHERE id = $1`, [admin.id]);
  const after = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(after.statusCode, 401, "a disabled admin's grant must stop working at once");
});

test("two-person credit control is about accounts, not names", () => {
  const sameName = "Dana Finance";
  // Two different people who happen to share a display name.
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: sameName },
      { adminUserId: randomUUID(), displayName: sameName },
    ),
  );
  // The same account, renamed between requesting and approving.
  const id = randomUUID();
  assert.throws(
    () => assertDistinctApprover({ adminUserId: id, displayName: "Dana F." }, { adminUserId: id, displayName: "Dana Finance" }),
    /self_approval_forbidden/,
  );
});
