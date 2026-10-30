/**
 * Integration test: every migration applies to an empty database, in order,
 * and a second run is a no-op. Guards against a migration that only works
 * on someone's long-lived dev database (0054 and 0055 both did, and a fresh
 * `npm run migrate` stopped at 0054 for every new environment).
 *
 * Requires DATABASE_URL pointing at a Postgres server where the role may
 * CREATE DATABASE. The test creates and drops its own throwaway database;
 * the database in DATABASE_URL is only used to connect.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/migrate.integration.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("migrate.integration.test.ts requires DATABASE_URL (a role that may CREATE DATABASE)");
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationFiles = readdirSync(join(here, "migrations")).filter((f) => f.endsWith(".sql"));
const scratchName = `fp_migrate_check_${process.pid}`;

function urlFor(database: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${database}`;
  return url.toString();
}

function runMigrate(url: string): string {
  return execFileSync("npx", ["tsx", join(here, "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
}

test("all migrations apply to an empty database, and re-running is a no-op", { timeout: 180_000 }, async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.query(`CREATE DATABASE ${scratchName}`);

  try {
    const scratchUrl = urlFor(scratchName);
    const first = runMigrate(scratchUrl);
    assert.match(first, new RegExp(`${migrationFiles.length} migration\\(s\\) applied, 0 already up to date`));

    const second = runMigrate(scratchUrl);
    assert.match(second, new RegExp(`0 migration\\(s\\) applied, ${migrationFiles.length} already up to date`));

    const db = new Client({ connectionString: scratchUrl });
    await db.connect();
    try {
      const applied = await db.query<{ n: string }>("SELECT count(*) AS n FROM schema_migrations");
      assert.equal(Number(applied.rows[0]!.n), migrationFiles.length);

      // 0054's view resolves against the real batching column.
      await db.query("SELECT event_id FROM v_unbatched_capture_events LIMIT 1");

      // ...and lists partial captures too: CloseBatch settles both
      // 'captured' and 'partially_captured' events.
      const m = await db.query<{ id: string }>(
        "INSERT INTO merchants (display_name, mdr_bps) VALUES ('view check', 250) RETURNING id",
      );
      const t = await db.query<{ id: string }>(
        `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
         VALUES ($1, 'partially_captured', 10000, 4000, 'acq-view-check', now()) RETURNING id`,
        [m.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
         VALUES ($1, 'captured', 1000, 'system', now()), ($1, 'partially_captured', 3000, 'system', now())`,
        [t.rows[0]!.id],
      );
      const unbatched = await db.query<{ event_type: string; amount_fils: string }>(
        "SELECT event_type, amount_fils FROM v_unbatched_capture_events WHERE transaction_id = $1 ORDER BY amount_fils",
        [t.rows[0]!.id],
      );
      assert.deepEqual(
        unbatched.rows.map((r) => [r.event_type, Number(r.amount_fils)]),
        [
          ["captured", 1000],
          ["partially_captured", 3000],
        ],
      );

      // 0055's suspense accounts exist with 0007's columns.
      const accounts = await db.query<{ id: string; kind: string }>(
        "SELECT id, kind FROM chart_of_accounts WHERE id IN ('fx_rounding_difference', 'chargeback_suspense') ORDER BY id",
      );
      assert.deepEqual(accounts.rows, [
        { id: "chargeback_suspense", kind: "asset" },
        { id: "fx_rounding_difference", kind: "asset" },
      ]);
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }
});
