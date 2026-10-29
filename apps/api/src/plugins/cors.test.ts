/**
 * Regression tests: the browser apps could not talk to the API at all
 * ("Failed to fetch"). They call it cross-origin with credentials, and the
 * API sent no CORS headers and no answer to the preflight.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("cors.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const baseEnv = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(loadConfig(baseEnv), pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

function preflight(origin: string, url = "/v1/auth/login") {
  return app.inject({
    method: "OPTIONS",
    url,
    headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
}

for (const origin of ["http://localhost:5173", "http://localhost:5174"]) {
  test(`a preflight from ${origin} is answered and allows credentials`, async () => {
    const res = await preflight(origin);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(String(res.headers["access-control-allow-methods"]), /POST/);
    assert.match(String(res.headers["access-control-allow-headers"]), /Content-Type/i);
  });
}

test("the actual response, success or error, carries the CORS headers too", async () => {
  const ok = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:5173" } });
  assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:5173");
  const err = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    headers: { origin: "http://localhost:5174" },
    payload: { email: "nobody@admin.test", password: "wrong" },
  });
  assert.ok(err.statusCode >= 400);
  assert.equal(err.headers["access-control-allow-origin"], "http://localhost:5174", "the app must be able to read the error");
  assert.equal(err.headers["access-control-allow-credentials"], "true");
});

test("an origin that isn't listed gets no CORS headers", async () => {
  const res = await preflight("https://evil.example");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
  const get = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
  assert.equal(get.headers["access-control-allow-origin"], undefined);
});

test("server-to-server calls (no Origin header) are unaffected", async () => {
  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("CORS_ALLOWED_ORIGINS: exact origins only, none by default in production", () => {
  const custom = loadConfig({ ...baseEnv, CORS_ALLOWED_ORIGINS: "https://dash.example.com, https://ops.example.com/" });
  assert.deepEqual(custom.corsAllowedOrigins, ["https://dash.example.com", "https://ops.example.com"]);
  assert.throws(() => loadConfig({ ...baseEnv, CORS_ALLOWED_ORIGINS: "*" }), /exact origin/);
  assert.throws(() => loadConfig({ ...baseEnv, CORS_ALLOWED_ORIGINS: "https://dash.example.com/app" }), /exact origin/);
  const prod = loadConfig({
    ...baseEnv,
    NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "t",
    ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
  });
  assert.deepEqual(prod.corsAllowedOrigins, []);
});
