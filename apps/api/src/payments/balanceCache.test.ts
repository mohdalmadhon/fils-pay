/**
 * The payable cache update is applied as its transaction's last statement
 * (docs/perf/checkout-capacity.md): same transaction and same total as
 * before, but the merchant's balance row is locked only for that statement
 * and the commit, not through the rest of checkout.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { applyPayableCacheDelta } from "./balanceCache.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("balanceCache.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
// One connection, so every transaction below reuses the same pooled client.
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

test.after(async () => {
  await pool.end();
});

async function merchantWithCache(start: number): Promise<string> {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ('Cache test ' || gen_random_uuid(), 250) RETURNING id`,
  );
  await pool.query(`INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, $2, now())`, [
    m.rows[0]!.id,
    start,
  ]);
  return m.rows[0]!.id;
}

async function cached(merchantId: string): Promise<number> {
  const r = await pool.query<{ v: string }>(`SELECT cached_payable_fils::text AS v FROM merchant_balances WHERE merchant_id = $1`, [merchantId]);
  return Number(r.rows[0]!.v);
}

test("inside a transaction the deltas add up and land just before commit", async () => {
  const merchantId = await merchantWithCache(1_000);
  await withTransaction(pool, async (client) => {
    await applyPayableCacheDelta(client, merchantId, 300);
    await applyPayableCacheDelta(client, merchantId, 25);
    // Not written yet: the row isn't locked while the rest of the work runs.
    const inside = await client.query<{ v: string }>(`SELECT cached_payable_fils::text AS v FROM merchant_balances WHERE merchant_id = $1`, [merchantId]);
    assert.equal(Number(inside.rows[0]!.v), 1_000);
  });
  assert.equal(await cached(merchantId), 1_325);
});

test("a rolled-back transaction changes nothing, now or in the connection's next transaction", async () => {
  const merchantId = await merchantWithCache(500);
  await assert.rejects(
    withTransaction(pool, async (client) => {
      await applyPayableCacheDelta(client, merchantId, 999);
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await cached(merchantId), 500);
  // Same pooled connection (max: 1): the rolled-back delta must not leak in.
  await withTransaction(pool, async (client) => {
    await applyPayableCacheDelta(client, merchantId, 1);
  });
  assert.equal(await cached(merchantId), 501);
});

test("outside withTransaction the delta is applied at once, as before", async () => {
  const merchantId = await merchantWithCache(10);
  const client = await pool.connect();
  try {
    await applyPayableCacheDelta(client, merchantId, 5);
  } finally {
    client.release();
  }
  assert.equal(await cached(merchantId), 15);
});
