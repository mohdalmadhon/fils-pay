/**
 * Regression tests for the inbound acquirer-callback signature check.
 *
 * Before the fix the check: accepted any callback with no signature header
 * (signatures were optional by default), verified a re-serialized copy of the
 * parsed body instead of the bytes received (so genuine callbacks sent with
 * different whitespace or key order failed), never looked at the timestamp
 * (so a captured callback could be replayed forever), and accepted
 * signatures made with an empty secret, which anyone can compute.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("acquirerCallbacksSignature.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const SECRET = "acqsec_signature_test_secret";
const baseEnv = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(loadConfig({ ...baseEnv, ACQUIRER_CALLBACK_SIGNING_SECRET: SECRET }), pool);
const appWithoutSecret = buildApp(loadConfig({ ...baseEnv }), pool);

test.after(async () => {
  await app.close();
  await appWithoutSecret.close();
  await pool.end();
});

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function sign(rawBody: string, secret = SECRET, timestamp = nowSeconds()): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

async function createTransaction(): Promise<string> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Callback Signature Merchant ${randomUUID()}`],
  );
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2) RETURNING id`,
    [merchant.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return txn.rows[0]!.id;
}

function callback(transactionId: string) {
  return {
    callbackId: `acqcb_${randomUUID()}`,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-10-29T10:00:00.000Z",
    outcome: "cleared",
    note: "Manual review cleared.",
  };
}

function postRaw(target: typeof app, rawBody: string, signature?: string) {
  return target.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "acquirer-callback-signature": signature } : {}),
    },
    payload: rawBody,
  });
}

async function notes(callbackId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM acquirer_callback_notes WHERE callback_id = $1`,
    [callbackId],
  );
  return Number(result.rows[0]!.n);
}

test("a callback with no signature is rejected 401 and saves nothing", async () => {
  const body = callback(await createTransaction());
  const res = await postRaw(app, JSON.stringify(body));
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(await notes(body.callbackId), 0);
});

test("a genuine callback is verified over its raw bytes, whatever its formatting or key order", async () => {
  const body = callback(await createTransaction());
  // Pretty-printed, keys reversed: JSON.stringify(JSON.parse(raw)) gives
  // different bytes, so verifying a re-serialized copy would fail.
  const raw = JSON.stringify(Object.fromEntries(Object.entries(body).reverse()), null, 2);
  const res = await postRaw(app, raw, sign(raw));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await notes(body.callbackId), 1);
});

test("a body changed after signing is rejected", async () => {
  const body = callback(await createTransaction());
  const raw = JSON.stringify(body);
  const tampered = raw.replace('"cleared"', '"confirmed_fraud"');
  const res = await postRaw(app, tampered, sign(raw));
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(await notes(body.callbackId), 0);
});

test("a correctly signed but stale callback (replay) is rejected", async () => {
  const body = callback(await createTransaction());
  const raw = JSON.stringify(body);
  const res = await postRaw(app, raw, sign(raw, SECRET, nowSeconds() - 3_600));
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(await notes(body.callbackId), 0);
});

test("a timestamp far in the future is rejected too", async () => {
  const body = callback(await createTransaction());
  const raw = JSON.stringify(body);
  const res = await postRaw(app, raw, sign(raw, SECRET, nowSeconds() + 3_600));
  assert.equal(res.statusCode, 401, res.body);
});

test("with no signing secret configured, even a 'valid' empty-key signature is rejected", async () => {
  const body = callback(await createTransaction());
  const raw = JSON.stringify(body);
  const res = await postRaw(appWithoutSecret, raw, sign(raw, ""));
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(await notes(body.callbackId), 0);
});

test("invalid JSON is a 400, not a crash", async () => {
  const raw = "{not json";
  const res = await postRaw(app, raw, sign(raw));
  assert.equal(res.statusCode, 400, res.body);
});

test("signatures cannot be switched off in production", () => {
  const config = loadConfig({
    ...baseEnv,
    NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "t",
    ACQUIRER_CALLBACK_SIGNING_SECRET: SECRET,
    ACQUIRER_CALLBACK_REQUIRE_SIGNATURE: "false",
  });
  assert.equal(config.acquirerCallbackRequireSignature, true);
  assert.equal(loadConfig({ ...baseEnv }).acquirerCallbackRequireSignature, true, "required by default");
  assert.equal(
    loadConfig({ ...baseEnv, ACQUIRER_CALLBACK_REQUIRE_SIGNATURE: "false" }).acquirerCallbackRequireSignature,
    false,
    "only a non-production environment may opt out",
  );
});
