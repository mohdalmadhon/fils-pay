/**
 * Follow-ups from an independent review of the security fixes (docs/cyper/18).
 *  - The login limit can't be dodged by spelling the merchant UUID differently
 *    (Postgres accepts upper case, braces, no hyphens) or by firing many
 *    requests at once.
 *  - A webhook receiver that stalls mid-body is a failed delivery.
 *  - 6to4 and IPv4-compatible IPv6 forms of private addresses are blocked.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";
import { createMerchant } from "../testing/adminFixtures.js";
import { isBlockedAddress } from "../webhooks/destination.js";
import { createFetchTransport } from "../webhooks/transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reviewFollowUps.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  LOGIN_MAX_FAILURES: "4",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 20 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const PASSWORD = "follow-up password 1!";
async function merchantUser() {
  const { merchantId } = await createMerchant(pool, "follow-up");
  const email = `fu-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(PASSWORD, config)],
  );
  return { merchantId, email };
}
const login = (merchantId: string, email: string, password: string) =>
  app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });

test("other spellings of the merchant UUID share one failure budget (or are refused)", async () => {
  const u = await merchantUser();
  const spellings = [
    u.merchantId,
    u.merchantId.toUpperCase(),
    `{${u.merchantId}}`,
    u.merchantId.replace(/-/g, ""),
    u.merchantId.slice(0, 4).toUpperCase() + u.merchantId.slice(4),
  ];
  for (let round = 0; round < 2; round += 1) {
    for (const id of spellings) {
      const r = await login(id, u.email, "wrong");
      assert.ok(r.statusCode === 401 || r.statusCode === 429, `${id}: ${r.statusCode}`);
    }
  }
  const res = await login(u.merchantId, u.email, PASSWORD);
  assert.equal(res.statusCode, 429, res.body);
});

test("a burst of parallel wrong passwords can't exceed the limit", async () => {
  const u = await merchantUser();
  const results = await Promise.all(Array.from({ length: 20 }, () => login(u.merchantId, u.email, "wrong")));
  const checked = results.filter((r) => r.statusCode === 401).length;
  assert.ok(checked <= 4, `${checked} passwords were checked, limit is 4`);
});

test("a correct login doesn't use up the budget", async () => {
  const u = await merchantUser();
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await login(u.merchantId, u.email, PASSWORD)).statusCode, 200);
  }
});

test("a receiver that stalls after sending part of the body is a failed delivery", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    // never ends
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const result = await createFetchTransport({ allowPrivateHosts: true })({
      url: `http://127.0.0.1:${port}/`,
      headers: {},
      body: "{}",
      timeoutMs: 500,
    });
    assert.equal(result.statusCode, null, JSON.stringify(result));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("6to4 and IPv4-compatible forms of private addresses are blocked", () => {
  for (const ip of ["2002:7f00:1::", "2002:a9fe:a9fe::1", "::7f00:1", "::127.0.0.1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});
