/**
 * expire_holds against a real, migrated Postgres. Runs inside a transaction
 * that is rolled back, so other holds in the database are never touched.
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { expireHolds } from "./expire_holds.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("expire_holds.integration.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

test("only active, past-expiry holds are deleted; an empty night deletes nothing", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Start from no expired holds, so the "empty night" case is real.
    await client.query(`DELETE FROM holds WHERE status = 'active' AND expires_at < now()`);
    const before = Number((await client.query(`SELECT count(*) FROM holds`)).rows[0].count);

    const merchant = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Expire Holds ${randomUUID()}`],
    );
    const m = merchant.rows[0]!.id;
    const insert = (status: string, expires: string) =>
      client.query<{ id: string }>(
        `INSERT INTO holds (merchant_id, amount_fils, status, expires_at) VALUES ($1, 1000, $2, now() + $3::interval) RETURNING id`,
        [m, status, expires],
      );
    const future = await insert("active", "1 day");
    const released = await insert("released", "-1 day");

    assert.equal(await expireHolds(client), 0, "nothing expired: nothing deleted");
    const afterEmpty = Number((await client.query(`SELECT count(*) FROM holds`)).rows[0].count);
    assert.equal(afterEmpty, before + 2, "an empty night must not wipe the table");

    const expired = await insert("active", "-1 day");
    assert.equal(await expireHolds(client), 1);
    const left = await client.query<{ id: string }>(`SELECT id FROM holds WHERE merchant_id = $1`, [m]);
    assert.deepEqual(
      left.rows.map((r) => r.id).sort(),
      [future.rows[0]!.id, released.rows[0]!.id].sort(),
      "the expired one is gone; the future and released holds stay",
    );
    assert.ok(!left.rows.some((r) => r.id === expired.rows[0]!.id));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
