/**
 * Regression tests for incident 2026-08-21: shops got two "your payout is on
 * the way" (settlement.paid) webhooks for one payout, and each batch got two
 * disbursement records.
 *
 * Two settlement runs enqueued settlement.paid for the same batch at the same
 * moment (two outbox rows, two outbox event ids). Each outbox row got its own
 * webhook delivery, and the dispatcher records a payout disbursement before
 * the first attempt of every settlement.paid delivery, so the duplicate also
 * reached the disbursement table. Migration 0075 makes both "one per batch".
 *
 * The Go side (EnqueuePayoutNotifications racing itself) is covered by
 * apps/settlement/internal/settlement/payout_notify_concurrency_test.go.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { recordPayoutDisbursementEffect } from "./payoutDisbursement.js";
import { replayWebhookDelivery } from "./replay.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payoutNotificationOnce.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

const pool = new Pool({ connectionString: databaseUrl, max: 10 });

test.after(async () => {
  await pool.end();
});

async function paidBatch(netPayoutFils = 471_300) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Payout Notify Once ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches
        (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
     VALUES ($1, current_date - 1, 'paid', $2, 0, $2, now(), now())
     RETURNING id`,
    [merchantId, netPayoutFils],
  );
  return { merchantId, batchId: batch.rows[0]!.id, netPayoutFils };
}

async function endpointFor(merchantId: string) {
  const url = `http://payout-receiver.test/${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  return { url, endpoint };
}

/** Insert a settlement.paid outbox row the way apps/settlement does. */
function insertPaidEvent(b: { merchantId: string; batchId: string; netPayoutFils: number }) {
  return pool.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ('settlement.paid', 'settlement_batch', $1, $2)
     ON CONFLICT (aggregate_id) WHERE event_type = 'settlement.paid' AND superseded_by IS NULL DO NOTHING`,
    [b.batchId, JSON.stringify({ merchantId: b.merchantId, batchId: b.batchId, batchDate: "2026-08-20", netPayoutFils: b.netPayoutFils })],
  );
}

function recordingTransport(urls: string[]) {
  const sent: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (urls.includes(req.url)) sent.push(req);
    return { statusCode: 200, body: "ok" };
  };
  return { transport, sent };
}

async function disbursements(batchId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM settlement_payout_disbursements WHERE settlement_batch_id = $1 AND duplicate_of IS NULL`,
    [batchId],
  );
  return r.rows[0]!.n;
}

test("the database refuses a second live settlement.paid event for the same batch", async () => {
  const b = await paidBatch();
  await assert.rejects(
    pool.query(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('settlement.paid', 'settlement_batch', $1, '{}'), ('settlement.paid', 'settlement_batch', $1, '{}')`,
      [b.batchId],
    ),
    /uq_outbox_settlement_paid_per_batch/,
  );
});

test("two runs enqueueing at the same moment produce one event and one webhook", async () => {
  const b = await paidBatch();
  const { url } = await endpointFor(b.merchantId);

  const inserted = await Promise.all(Array.from({ length: 6 }, () => insertPaidEvent(b)));
  assert.equal(inserted.reduce((n, r) => n + (r.rowCount ?? 0), 0), 1, "exactly one run may enqueue the event");

  const { transport, sent } = recordingTransport([url]);
  await runDispatchPass(pool, transport, config);
  assert.equal(sent.length, 1, "the shop gets one 'your payout is on the way' webhook");
  assert.equal(await disbursements(b.batchId), 1);
});

test("a duplicate event marked superseded gets no delivery", async () => {
  const b = await paidBatch();
  const { url } = await endpointFor(b.merchantId);
  await insertPaidEvent(b);
  const kept = await pool.query<{ id: string }>(
    `SELECT id FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1`,
    [b.batchId],
  );
  // What migration 0075 does to a historical duplicate.
  const duplicate = await pool.query<{ id: string }>(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, superseded_by)
     VALUES ('settlement.paid', 'settlement_batch', $1, $2, $3) RETURNING id`,
    [b.batchId, JSON.stringify({ merchantId: b.merchantId, batchId: b.batchId, batchDate: "2026-08-20", netPayoutFils: b.netPayoutFils }), kept.rows[0]!.id],
  );

  const { transport } = recordingTransport([url]);
  await runDispatchPass(pool, transport, config);
  await runDispatchPass(pool, transport, config);

  const deliveries = await pool.query<{ outbox_event_id: string }>(
    `SELECT outbox_event_id FROM webhook_deliveries WHERE outbox_event_id = ANY($1::bigint[])`,
    [[kept.rows[0]!.id, duplicate.rows[0]!.id]],
  );
  assert.deepEqual(
    deliveries.rows.map((r) => String(r.outbox_event_id)),
    [String(kept.rows[0]!.id)],
    "only the kept event is delivered",
  );
});

test("one payout delivered to two endpoints, then replayed, records one disbursement", async () => {
  const b = await paidBatch();
  const first = await endpointFor(b.merchantId);
  const second = await endpointFor(b.merchantId);
  await insertPaidEvent(b);

  const { transport, sent } = recordingTransport([first.url, second.url]);
  await runDispatchPass(pool, transport, config);
  assert.equal(sent.length, 2, "each endpoint is still notified");

  const delivery = await pool.query<{ id: string }>(
    `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1 AND replay_of_delivery_id IS NULL`,
    [first.endpoint.id],
  );
  await replayWebhookDelivery(pool, { merchantId: b.merchantId, endpointId: first.endpoint.id, deliveryId: delivery.rows[0]!.id });
  await runDispatchPass(pool, transport, config);

  assert.equal(await disbursements(b.batchId), 1, "one payout, one disbursement record");
});

test("concurrent disbursement effects for one batch write one record", async () => {
  const b = await paidBatch(90_000);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => recordPayoutDisbursementEffect(pool, b.batchId, b.netPayoutFils)),
  );
  assert.equal(results.filter(Boolean).length, 1, "only one call reports that it wrote the record");
  assert.equal(await disbursements(b.batchId), 1);
});
