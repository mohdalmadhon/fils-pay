#!/usr/bin/env -S npx tsx
/**
 * Nightly janitor: a hold that's never captured or released just sits in
 * the table past its expires_at forever — nothing else in the platform
 * ever deletes a holds row (authorize.ts inserts one, capture.ts/void.ts
 * release one; nothing sweeps one). Run once a night from cron/the host's
 * own scheduler.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/expire_holds.ts
 */
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/**
 * The whole job is one statement. The predicate is in the DELETE itself, so:
 *   - a night with nothing expired deletes nothing (the old SELECT-ids-then-
 *     DELETE-by-ids version built a bare "DELETE FROM holds" from an empty
 *     id list and wiped the table);
 *   - a hold captured or voided (status 'released') between "find" and
 *     "delete" can't be deleted, because there is no gap between them.
 */
export const EXPIRE_HOLDS_SQL = `DELETE FROM holds WHERE status = 'active' AND expires_at < now() RETURNING id`;

/** Deletes holds that are still 'active' and past expires_at; returns how
 *  many. Captured, voided ('released') and future holds are never touched. */
export async function expireHolds(client: Pick<Client, "query">): Promise<number> {
  const result = await client.query(EXPIRE_HOLDS_SQL);
  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("expire_holds: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const deleted = await expireHolds(client);
    console.log(`expire_holds: deleted ${deleted} abandoned hold(s)`);
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
