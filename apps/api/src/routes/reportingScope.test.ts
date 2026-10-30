/**
 * Route-level checks for /v1/reporting:
 *   - the transactions report refuses another parent's split child (403);
 *   - export-summary requires merchant auth (401 without it, 200 with it).
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reportingScope.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchantWithKey(label: string) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reporting Scope ${label} ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label });
  return { merchantId, headers: { authorization: `Bearer ${issued.rawKey}` } };
}

test("transactions report: another parent's split child is refused with 403", async () => {
  const parent = await merchantWithKey("parent");
  const child = await merchantWithKey("child");
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent.merchantId, child.merchantId],
  );
  const attacker = await merchantWithKey("attacker");
  const filter = encodeURIComponent(JSON.stringify({ merchantId: child.merchantId }));

  const denied = await app.inject({ method: "GET", url: `/v1/reporting/transactions?filter=${filter}`, headers: attacker.headers });
  assert.equal(denied.statusCode, 403, denied.body);

  const allowed = await app.inject({ method: "GET", url: `/v1/reporting/transactions?filter=${filter}`, headers: parent.headers });
  assert.equal(allowed.statusCode, 200, allowed.body);
});

test("export-summary requires merchant auth", async () => {
  const anon = await app.inject({ method: "GET", url: "/v1/reporting/export-summary" });
  assert.equal(anon.statusCode, 401, anon.body);

  const m = await merchantWithKey("summary");
  const ok = await app.inject({ method: "GET", url: "/v1/reporting/export-summary", headers: m.headers });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { totalDays: 0, grossFils: 0 });
});

test("transactions report: a filter that isn't a valid object is a 400, not a 500", async () => {
  const m = await merchantWithKey("bad-filter");
  const bad = [
    "null",
    "[]",
    "5",
    JSON.stringify({ from: "garbage" }),
    JSON.stringify({ to: "2026-02-30" }),
    JSON.stringify({ from: "2026-01-01T25:00:00Z" }),
    JSON.stringify({ status: "nope" }),
    JSON.stringify({ status: 5 }),
  ];
  for (const filter of bad) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reporting/transactions?filter=${encodeURIComponent(filter)}`,
      headers: m.headers,
    });
    assert.equal(res.statusCode, 400, `${filter}: ${res.body}`);
    assert.equal(res.json().error, "invalid_filter");
  }

  const twice = await app.inject({ method: "GET", url: "/v1/reporting/transactions?filter=%7B%7D&filter=%7B%7D", headers: m.headers });
  assert.equal(twice.statusCode, 400, twice.body);

  const good = JSON.stringify({ status: "captured", from: "2026-06-01", to: "2026-07-01T00:00:00+03:00" });
  const ok = await app.inject({ method: "GET", url: `/v1/reporting/transactions?filter=${encodeURIComponent(good)}`, headers: m.headers });
  assert.equal(ok.statusCode, 200, ok.body);
});
