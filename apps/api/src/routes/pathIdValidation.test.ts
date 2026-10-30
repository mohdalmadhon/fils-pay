/**
 * Merchant-plane routes with an id in the path answer a non-UUID id with
 * 404 (the id can't name a row), not a 500 from a failed ::uuid cast; and a
 * webhook endpoint status other than active/disabled is a 400.
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
import { createMerchant, parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("pathIdValidation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

const PASSWORD = "path id test password 1!";

async function ownerSession() {
  const { merchantId } = await createMerchant(pool, "path-ids");
  const email = `owner-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(PASSWORD, config)],
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

test("non-UUID ids in webhook, API key and KYC document paths are 404s, not 500s", async () => {
  const { merchantId, cookie } = await ownerSession();
  const base = `/v1/merchants/${merchantId}`;
  const cases: Array<["GET" | "POST" | "PATCH" | "DELETE", string, string, unknown?]> = [
    ["DELETE", `${base}/webhook-endpoints/nope`, "webhook_endpoint_not_found"],
    ["PATCH", `${base}/webhook-endpoints/nope`, "webhook_endpoint_not_found", { status: "disabled" }],
    ["POST", `${base}/webhook-endpoints/nope/test`, "webhook_endpoint_not_found", {}],
    ["GET", `${base}/webhook-endpoints/nope/deliveries`, "webhook_endpoint_not_found"],
    ["GET", `${base}/webhook-endpoints/${randomUUID()}/deliveries/nope`, "webhook_delivery_not_found"],
    ["POST", `${base}/webhook-endpoints/${randomUUID()}/deliveries/nope/replay`, "webhook_delivery_not_found", {}],
    ["DELETE", `${base}/api-keys/nope`, "api_key_not_found"],
    ["GET", `${base}/kyc/documents/nope/file`, "kyc_document_not_found"],
    ["GET", `${base}/kyc/documents/nope/thumbnail`, "kyc_thumbnail_not_found"],
  ];
  for (const [method, url, code, payload] of cases) {
    const res = await app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
    assert.equal(res.statusCode, 404, `${method} ${url}: ${res.body}`);
    assert.equal(res.json().error, code, `${method} ${url}`);
  }
});

test("PATCH webhook endpoint: a status other than active or disabled is a 400", async () => {
  const { merchantId, cookie } = await ownerSession();
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/webhook-endpoints`,
    headers: { cookie },
    payload: { url: "https://example.com/hook" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = (created.json() as { id: string }).id;

  for (const status of ["paused", 5]) {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchants/${merchantId}/webhook-endpoints/${id}`,
      headers: { cookie },
      payload: { status },
    });
    assert.equal(res.statusCode, 400, `${status}: ${res.body}`);
    assert.equal(res.json().error, "invalid_status");
  }
  const row = await pool.query<{ status: string }>(`SELECT status FROM webhook_endpoints WHERE id = $1`, [id]);
  assert.equal(row.rows[0]!.status, "active");
});
