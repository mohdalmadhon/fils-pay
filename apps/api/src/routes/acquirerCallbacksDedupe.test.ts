/**
 * Regression tests for "duplicated acquirer callback notes".
 *
 * The acquirer redelivers a callback (same callbackId, same transaction)
 * when our acknowledgement is slow. Every delivery used to insert a new
 * acquirer_callback_notes row, so one payment ended up with identical
 * duplicate notes. A redelivery is now a no-op that still answers 200, so
 * the acquirer stops retrying.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { applyAcquirerCallback, type AcquirerCallbackInput } from "../acquirer/callbacks.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("acquirerCallbacksDedupe.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const ACQUIRER_SECRET = "acqsec_dedupe_test_secret";

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ACQUIRER_CALLBACK_SIGNING_SECRET: ACQUIRER_SECRET,
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function createTransaction(): Promise<string> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Callback Dedupe Merchant ${randomUUID()}`],
  );
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2) RETURNING id`,
    [merchant.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return txn.rows[0]!.id;
}

function body(transactionId: string, callbackId: string): AcquirerCallbackInput {
  return {
    callbackId,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-09-16T10:00:00.000Z",
    outcome: "confirmed_fraud",
    note: "Manual review flagged card testing pattern; recommend void.",
  };
}

function signed(payload: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", ACQUIRER_SECRET)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest("hex");
  return { "acquirer-callback-signature": `t=${timestamp},v1=${signature}` };
}

function post(payload: AcquirerCallbackInput) {
  return app.inject({ method: "POST", url: "/v1/acquirer/callbacks", headers: signed(payload), payload });
}

async function notesFor(transactionId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM acquirer_callback_notes WHERE transaction_id = $1`,
    [transactionId],
  );
  return Number(result.rows[0]!.n);
}

test("the same callback delivered twice is acknowledged both times but saved once", async () => {
  const transactionId = await createTransaction();
  const payload = body(transactionId, `acqcb_${randomUUID()}`);

  const first = await post(payload);
  const second = await post(payload);

  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json(), { received: true });
  assert.equal(await notesFor(transactionId), 1);
});

test("concurrent redeliveries of one callback still save exactly one note", async () => {
  const transactionId = await createTransaction();
  const payload = body(transactionId, `acqcb_${randomUUID()}`);

  const results = await Promise.all(Array.from({ length: 5 }, () => post(payload)));

  for (const res of results) assert.equal(res.statusCode, 200, res.body);
  assert.equal(await notesFor(transactionId), 1);
});

test("calling applyAcquirerCallback again for the same callback inserts nothing new", async () => {
  const transactionId = await createTransaction();
  const payload = body(transactionId, `acqcb_${randomUUID()}`);

  await applyAcquirerCallback(pool, payload);
  await applyAcquirerCallback(pool, payload);

  assert.equal(await notesFor(transactionId), 1);
});

test("two different callbacks for one payment are both kept", async () => {
  const transactionId = await createTransaction();

  assert.equal((await post(body(transactionId, `acqcb_${randomUUID()}`))).statusCode, 200);
  assert.equal((await post(body(transactionId, `acqcb_${randomUUID()}`))).statusCode, 200);

  assert.equal(await notesFor(transactionId), 2);
});

test("the same callbackId on two different payments is not treated as a redelivery", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const txnA = await createTransaction();
  const txnB = await createTransaction();

  assert.equal((await post(body(txnA, callbackId))).statusCode, 200);
  assert.equal((await post(body(txnB, callbackId))).statusCode, 200);

  assert.equal(await notesFor(txnA), 1);
  assert.equal(await notesFor(txnB), 1);
});
