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
  await bootstrapSchemaMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  const files = listMigrationFiles(dir);

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

async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
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
