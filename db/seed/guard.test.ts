/**
 * The seed wipes the database (TRUNCATE ... CASCADE on merchants,
 * transactions, ledger_entries, settlement_batches, admin_users and more),
 * so it must refuse to run where that would destroy real data.
 *
 * Before the fix it ran anywhere, compose ran it on every `docker compose
 * up`, and a compose note said pointing it at a shared database was fine.
 *
 * Requires DATABASE_URL pointing at a migrated database that holds at least
 * one merchant the seed didn't create (any database the API tests ran on).
 * Nothing is truncated: only the guard is called.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/seed/guard.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { assertSeedMayReset } from "./guard.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("guard.test.ts requires DATABASE_URL");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

test("refuses with NODE_ENV=production, whatever else is set", async () => {
  const db = (await pool.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0]!.db;
  await assert.rejects(assertSeedMayReset(pool, { NODE_ENV: "production", SEED_RESET_CONFIRM: db }), /production/);
});

test("refuses a database holding merchants the seed didn't create, unless confirmed by name", async () => {
  await pool.query(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250)`, [`Real Customer ${randomUUID()}`]);
  await assert.rejects(assertSeedMayReset(pool, {}), /SEED_RESET_CONFIRM/);
  await assert.rejects(assertSeedMayReset(pool, { SEED_RESET_CONFIRM: "some-other-db" }), /SEED_RESET_CONFIRM/);
  const db = (await pool.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0]!.db;
  await assertSeedMayReset(pool, { SEED_RESET_CONFIRM: db });
});
