/**
 * Regression tests for "has anyone tried uploading a really large export?"
 *
 *  - Webhook delivery archives used to be built as one JSON string in the API
 *    and stored in one text column, and replay parsed it all back. A large
 *    range needed the whole history in memory and failed past V8's string
 *    limit or Postgres's 1 GB field limit. They are now one row per delivery,
 *    copied and replayed inside Postgres.
 *  - Adjustment CSV uploads ran under Fastify's default 1 MB body limit.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createMerchant, signedInAdmin } from "../testing/adminFixtures.js";
import { createWebhookDeliveryArchive, readArchiveEntries, replayWebhookDeliveryArchive } from "./archiveReplay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("largeExport.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ADJUSTMENT_IMPORT_MAX_ROWS: "50",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  // The replayed rows are real pending deliveries to an endpoint with no
  // usable secret. Left pending, they would fill every dispatcher pass of the
  // other test files sharing this database.
  await pool.query(
    `UPDATE webhook_deliveries wd SET status = 'exhausted'
       FROM webhook_endpoints we
      WHERE we.id = wd.endpoint_id AND we.url LIKE 'https://receiver.test/%' AND we.secret_ciphertext = 'unused'
        AND wd.status = 'pending'`,
  );
  await app.close();
  await pool.end();
});

const DELIVERIES = 25_000;

async function endpoint(merchantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO webhook_endpoints (merchant_id, url, secret_ciphertext, secret_prefix, status, created_by_type, created_by_id)
     VALUES ($1, $2, 'unused', 'whsec_testpre', 'active', 'merchant_session', $3) RETURNING id`,
    [merchantId, `https://receiver.test/${randomUUID()}`, randomUUID()],
  );
  return r.rows[0]!.id;
}

test(`a ${DELIVERIES.toLocaleString("en")}-delivery archive is captured, paged and restored in full`, async () => {
  const { merchantId } = await createMerchant(pool, "large-archive");
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'x', 'Large Archive', 'finance') RETURNING id`,
    [`large-archive-${randomUUID()}@admin.test`],
  );
  const adminUserId = admin.rows[0]!.id;
  const source = await endpoint(merchantId);
  const target = await endpoint(merchantId);

  // Seed the deliveries in SQL: one outbox event each (deliveries are unique
  // per event and endpoint), spread over a month, with a few KB of payload.
  await pool.query(
    `WITH ev AS (
       INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       SELECT 'transaction.captured', 'transaction', gen_random_uuid(), '{}'::jsonb FROM generate_series(1, $2)
       RETURNING id
     ), numbered AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM ev)
     INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, created_at)
     SELECT $1, numbered.id, 'transaction.captured', gen_random_uuid(),
            jsonb_build_object('n', numbered.n, 'blob', repeat('x', 2000)),
            timestamptz '2026-06-01T00:00:00Z' + numbered.n * interval '90 seconds'
       FROM numbered`,
    [source, DELIVERIES],
  );

  const from = new Date("2026-06-01T00:00:00Z");
  const to = new Date("2026-07-01T00:00:00Z");
  const created = await createWebhookDeliveryArchive(pool, { merchantId, endpointId: source, adminUserId, from, to });
  assert.equal(created.deliveryCount, DELIVERIES);

  const row = await pool.query<{ archive_payload: string | null; delivery_count: number }>(
    `SELECT archive_payload, delivery_count FROM webhook_delivery_archives WHERE id = $1`,
    [created.archiveId],
  );
  assert.equal(row.rows[0]!.archive_payload, null, "no single giant JSON value any more");
  assert.equal(row.rows[0]!.delivery_count, DELIVERIES);

  // Page through the whole archive, 1000 at a time, in capture order.
  let seen = 0;
  let afterSeq = 0;
  let lastN = 0;
  for (;;) {
    const page = await readArchiveEntries(pool, { merchantId, archiveId: created.archiveId, afterSeq });
    if (page.length === 0) break;
    assert.ok(page.length <= 1000);
    for (const e of page) {
      const n = Number((e.payload as { n: number }).n);
      assert.ok(n > lastN, "entries come back in capture order");
      lastN = n;
    }
    seen += page.length;
    afterSeq = page[page.length - 1]!.seq;
  }
  assert.equal(seen, DELIVERIES);

  const replayed = await replayWebhookDeliveryArchive(pool, {
    merchantId,
    archiveId: created.archiveId,
    targetEndpointId: target,
    adminUserId,
  });
  assert.equal(replayed.replayedCount, DELIVERIES);

  const check = await pool.query<{ n: number; linked: number; ids_match: number }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE replay_of_delivery_id IS NOT NULL)::int AS linked,
            count(*) FILTER (WHERE payload->>'id' = delivery_event_id::text)::int AS ids_match
       FROM webhook_deliveries WHERE endpoint_id = $1`,
    [target],
  );
  assert.deepEqual(check.rows[0], { n: DELIVERIES, linked: DELIVERIES, ids_match: DELIVERIES });
});


test("an adjustment CSV bigger than 1 MB is accepted", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "large-csv");
  const { merchantId } = await createMerchant(pool, "large-csv");
  const reason = "r".repeat(30_000);
  const lines = Array.from({ length: 40 }, () => `${merchantId},1.000,${reason}`);
  const csvContent = `merchantId,amount,reason\n${lines.join("\n")}\n`;
  assert.ok(Buffer.byteLength(csvContent) > 1024 * 1024, "the body must be over the old 1 MB limit");

  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/adjustment-imports",
    headers: { cookie: finance.cookie },
    payload: { csvContent, originalFilename: "big.csv" },
  });
  assert.equal(res.statusCode, 201, res.body.slice(0, 300));
  assert.equal((res.json() as { rowCount: number }).rowCount, 40);
});

test("an adjustment CSV over the row limit is refused with a clear message and posts nothing", async () => {
  const finance = await signedInAdmin(app, pool, config, "finance", "too-many-rows");
  const { merchantId } = await createMerchant(pool, "too-many-rows");
  const lines = Array.from({ length: config.adjustmentImportMaxRows + 1 }, () => `${merchantId},1.000,x`);
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/adjustment-imports",
    headers: { cookie: finance.cookie },
    payload: { csvContent: `merchantId,amount,reason\n${lines.join("\n")}\n` },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error, "import_too_large");
  const posted = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_entries WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(posted.rows[0]!.n, 0);
});
