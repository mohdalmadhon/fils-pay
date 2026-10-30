#!/usr/bin/env -S npx tsx
/**
 * Tiny migration runner: applies db/migrations/*.sql in lexical order,
 * tracked in a bootstrap `schema_migrations` table. The bootstrap table is
 * created by this runner on first connect — it is deliberately not itself a
 * numbered migration file, to avoid a circular "how do you migrate the
 * table that tracks migrations" dependency.
 *
 * Idempotent: re-running against a database that already has some or all
 * migrations applied only applies the ones missing from schema_migrations.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx db/migrate.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("migrate: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await runMigrations(client, MIGRATIONS_DIR);
  } finally {
    await client.end();
  }
}

/**
 * Applies every .sql file in `dir` that schema_migrations doesn't list yet,
 * in lexical order, one transaction per file, and records the file's
 * checksum with it. Exported so tests can run it against a scratch
 * database and directory.
 */
export async function runMigrations(
  client: Client,
  dir: string,
  log: (line: string) => void = console.log,
): Promise<{ applied: number; upToDate: number }> {
  // One runner at a time per database (two deploys starting together would
  // otherwise both try to apply the same file). Released in the finally.
  await client.query("SELECT pg_advisory_lock(hashtext('filspay:migrate'))");
  try {
    return await runLocked(client, dir, log);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('filspay:migrate'))");
  }
}

async function runLocked(
  client: Client,
  dir: string,
  log: (line: string) => void,
): Promise<{ applied: number; upToDate: number }> {
  await bootstrapSchemaMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  const files = listMigrationFiles(dir);
  // The check and any checksums it records commit together, or not at all,
  // so a refused run leaves schema_migrations exactly as it was.
  await client.query("BEGIN");
  try {
    await verifyAppliedChecksums(client, dir, files, applied, log);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  let appliedCount = 0;
  for (const filename of files) {
    if (applied.has(filename)) {
      log(`SKIP  ${filename}  (already applied)`);
      continue;
    }

    const sql = readFileSync(join(dir, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
        filename,
        migrationChecksum(sql),
      ]);
      await client.query("COMMIT");
      log(`APPLY ${filename}`);
      appliedCount += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migrate: failed applying ${filename}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  log(`migrate: ${appliedCount} migration(s) applied, ${files.length - appliedCount} already up to date`);
  return { applied: appliedCount, upToDate: files.length - appliedCount };
}

/**
 * sha256 of the file with CRLF normalised to LF, so a Windows checkout
 * (core.autocrlf) of an unchanged file has the same checksum.
 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

// schema_migrations stores a checksum per applied file (sha256, CRLF
// normalised). Databases created before checksums existed get the column
// added here; their rows start with checksum NULL.
async function bootstrapSchemaMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
}

async function getAppliedMigrations(client: Client): Promise<Map<string, string | null>> {
  const result = await client.query<{ filename: string; checksum: string | null }>(
    "SELECT filename, checksum FROM schema_migrations",
  );
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

/**
 * Before applying anything, compares every applied file still on disk with
 * the checksum recorded for it. A mismatch means the file was edited after
 * it ran, so this database and a new one built from the same files would
 * differ; the runner stops and names the files. Rows from before checksums
 * existed (checksum NULL) adopt the current file's checksum, once: that
 * first run trusts the files on disk, so run it from main, not from a
 * branch that edits an applied migration.
 *
 * MIGRATE_ACCEPT_CHANGED=<file>[,<file>...] accepts a reviewed change
 * (a comment fix, say) and records the new checksum. See docs/RUNBOOK.md.
 */
async function verifyAppliedChecksums(
  client: Client,
  dir: string,
  files: string[],
  applied: Map<string, string | null>,
  log: (line: string) => void,
): Promise<void> {
  const accepted = new Set(
    (process.env.MIGRATE_ACCEPT_CHANGED ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const changed: string[] = [];
  for (const filename of files) {
    if (!applied.has(filename)) continue;
    const recorded = applied.get(filename) ?? null;
    const current = migrationChecksum(readFileSync(join(dir, filename), "utf8"));
    if (recorded === current) continue;
    if (recorded === null) {
      await client.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", [filename, current]);
      log(`RECORD ${filename}  (checksum recorded for a migration applied before checksums)`);
    } else if (accepted.has(filename)) {
      await client.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", [filename, current]);
      log(`ACCEPT ${filename}  (changed after it was applied; accepted by MIGRATE_ACCEPT_CHANGED)`);
    } else {
      changed.push(filename);
    }
  }
  if (changed.length > 0) {
    throw new Error(
      `migrate: ${changed.join(", ")} changed after it was applied. ` +
        "Put the change in a new migration and restore the file (git checkout). " +
        "If the edit is reviewed and harmless (a comment, say), rerun with " +
        `MIGRATE_ACCEPT_CHANGED=${changed.join(",")}. Nothing was applied.`,
    );
  }
}

// FH: numbering gaps (0039, 0041, ...) make this fail on a fresh DB?
// — unsigned: it just sorts names. gaps don't matter.
function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

// Run only when executed directly (npm run migrate), not when a test imports it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
