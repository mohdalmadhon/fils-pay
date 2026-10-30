/**
 * The tier keeps applying once lifetime volume passes the old INTEGER limit
 * (2,147,483,647 fils). Before migration 0080 the column couldn't hold such a
 * value at all. Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { getVolumeTierBonusBps } from "./platformVolumeTier.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("platformVolumeTierBigint.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
test.after(async () => {
  await pool.end();
});

test("the tier applies past the old int32 limit", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE platform_stats SET total_processed_fils = 5000000000 WHERE id = 1`);
    assert.equal(await getVolumeTierBonusBps(client), 15);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
