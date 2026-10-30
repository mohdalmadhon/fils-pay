/**
 * Whether the seed may run against this database (docs/improvements/12).
 *
 * The seed starts with one TRUNCATE ... CASCADE over merchants,
 * transactions, ledger_entries, settlement_batches, outbox_events,
 * admin_users and more: it empties the database. A compose note said it
 * "only truncates its own fixture tables, so pointing this at a shared
 * database is fine"; that was wrong, and compose ran it on every `up`.
 *
 * Refuses when:
 *   - NODE_ENV is production (no override); or
 *   - the database holds any merchant that isn't a seed fixture, unless
 *     SEED_RESET_CONFIRM is set to this database's name.
 * A brand-new or previously seeded database passes without a flag.
 */
import type { Pool } from "pg";
import { MERCHANT_FIXTURES } from "./fixtures/merchants.js";

export async function assertSeedMayReset(pool: Pool, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "seed: refusing to run with NODE_ENV=production. The seed truncates merchants, transactions and the ledger.",
    );
  }
  const fixtureNames = MERCHANT_FIXTURES.map((m) => m.displayName);
  const result = await pool.query<{ db: string; foreign: string }>(
    `SELECT current_database() AS db,
            (SELECT count(*) FROM merchants WHERE display_name <> ALL($1::text[]))::text AS foreign`,
    [fixtureNames],
  );
  const row = result.rows[0]!;
  if (Number(row.foreign) > 0 && env.SEED_RESET_CONFIRM !== row.db) {
    throw new Error(
      `seed: database "${row.db}" holds ${row.foreign} merchant(s) the seed didn't create, and the seed would ` +
        `delete everything in it. If that is really what you want, run again with SEED_RESET_CONFIRM=${row.db}.`,
    );
  }
}
