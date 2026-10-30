/**
 * Fastify's own client errors (bad JSON, oversize body, wrong Content-Type)
 * must come back with their 4xx status, not as a 500 internal_error.
 * Requires DATABASE_URL (buildApp needs a pool; these requests never reach it).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("errorHandler.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("Fastify client errors keep their 4xx status instead of becoming a 500", async () => {
  const malformed = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: '{"email": "a@b.test",',
  });
  assert.equal(malformed.statusCode, 400, malformed.body);
  assert.equal(malformed.json().error, "invalid_json");

  const empty = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: "",
  });
  assert.equal(empty.statusCode, 400, empty.body);

  const oversize = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ email: "a@b.test", password: "x".repeat(2 * 1024 * 1024) }),
  });
  assert.equal(oversize.statusCode, 413, oversize.body);
  assert.equal(oversize.json().error, "payload_too_large");

  const wrongType = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/x-unknown" },
    payload: "hello",
  });
  assert.equal(wrongType.statusCode, 415, wrongType.body);
  assert.equal(wrongType.json().error, "unsupported_media_type");
});
