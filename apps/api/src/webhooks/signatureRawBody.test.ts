/**
 * Regression tests for "merchants can't verify our webhook signatures".
 *
 * A merchant's receiver does what every webhook guide tells it to do: take
 * the request body exactly as it arrived, compute
 * HMAC-SHA256(secret, `${t}.${rawBody}`) and compare it with `v1`. It does NOT
 * parse the JSON and re-serialise it first. These tests verify the same way —
 * with their own HMAC, not with sign.ts — so they fail if the bytes we sign
 * and the bytes we send ever differ again.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { replayWebhookDelivery } from "./replay.js";
import { sendTestWebhookEvent } from "./testSend.js";
import { verifyRawBody } from "./sign.js";
import { WEBHOOK_SIGNATURE_HEADER } from "./headers.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("signatureRawBody.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "5",
  WEBHOOK_BACKOFF_BASE_MS: "1000",
  WEBHOOK_BACKOFF_CAP_MS: "60000",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

/** What a merchant's receiver does: HMAC over the raw bytes it received. */
function merchantVerifies(rawBody: string, header: string, secret: string): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[2]!, "hex"));
}

async function merchantWithEndpoint(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Raw Body Signature ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const url = `http://raw-body-receiver.test/${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  return { merchantId, url, endpoint };
}

function capturingTransport(url: string, statusCode = 200) {
  const sent: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (req.url === url) sent.push(req);
    return { statusCode: req.url === url ? statusCode : 200, body: "ok" };
  };
  return { transport, sent };
}

test("a transaction.captured delivery verifies over the raw body the merchant receives", async () => {
  const { merchantId, url, endpoint } = await merchantWithEndpoint("captured");
  await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });

  const { transport, sent } = capturingTransport(url);
  await runDispatchPass(pool, transport, config);

  assert.equal(sent.length, 1);
  const req = sent[0]!;
  assert.ok(
    merchantVerifies(req.body, req.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret),
    `signature must verify over the exact bytes sent: ${req.body}`,
  );
});

test("a settlement.paid delivery verifies over the raw body", async () => {
  const { merchantId, url, endpoint } = await merchantWithEndpoint("paid");
  await enqueueEvent(pool, {
    eventType: "settlement.paid",
    aggregateType: "settlement_batch",
    aggregateId: randomUUID(),
    payload: { merchantId, batchId: randomUUID(), batchDate: "2026-10-28", netPayoutFils: 0 },
  });

  const { transport, sent } = capturingTransport(url);
  await runDispatchPass(pool, transport, config);

  assert.equal(sent.length, 1);
  assert.ok(merchantVerifies(sent[0]!.body, sent[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));
});

test("a retried delivery and a replayed delivery both verify over the raw body", async () => {
  const { merchantId, url, endpoint } = await merchantWithEndpoint("retry-replay");
  await enqueueEvent(pool, {
    eventType: "transaction.voided",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId },
  });

  // First attempt fails, so the row is retried.
  const failing = capturingTransport(url, 500);
  await runDispatchPass(pool, failing.transport, config);
  const delivery = await pool.query<{ id: string }>(
    `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1 AND replay_of_delivery_id IS NULL`,
    [endpoint.id],
  );
  const deliveryId = delivery.rows[0]!.id;
  await pool.query(`UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [
    deliveryId,
  ]);

  const retry = capturingTransport(url);
  await runDispatchPass(pool, retry.transport, config);
  assert.equal(retry.sent.length, 1);
  assert.ok(merchantVerifies(retry.sent[0]!.body, retry.sent[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));

  await replayWebhookDelivery(pool, { merchantId, endpointId: endpoint.id, deliveryId });
  const replay = capturingTransport(url);
  await runDispatchPass(pool, replay.transport, config);
  assert.equal(replay.sent.length, 1);
  assert.ok(merchantVerifies(replay.sent[0]!.body, replay.sent[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));
});

test("the 'send test event' tool signs exactly the bytes it sends", async () => {
  const { merchantId, url, endpoint } = await merchantWithEndpoint("test-send");
  const { transport, sent } = capturingTransport(url);

  await sendTestWebhookEvent(pool, config, transport, { merchantId, endpointId: endpoint.id });

  assert.equal(sent.length, 1);
  assert.ok(merchantVerifies(sent[0]!.body, sent[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));
});

test("verifyRawBody accepts the raw body, and rejects it after a single byte changes", async () => {
  const { merchantId, url, endpoint } = await merchantWithEndpoint("verify-raw");
  const { transport, sent } = capturingTransport(url);
  await sendTestWebhookEvent(pool, config, transport, { merchantId, endpointId: endpoint.id });

  const { body, headers } = sent[0]!;
  const header = headers[WEBHOOK_SIGNATURE_HEADER]!;
  assert.deepEqual(verifyRawBody(body, header, endpoint.secret), { valid: true });
  assert.equal(verifyRawBody(`${body} `, header, endpoint.secret).reason, "signature_mismatch");
  assert.equal(verifyRawBody(body, header, "whsec_wrong").reason, "signature_mismatch");
});
