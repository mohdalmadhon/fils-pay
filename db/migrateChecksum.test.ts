/**
 * The migration runner records a checksum per applied file and refuses to
 * run when an applied file has changed (docs/improvements/15). A comment in
 * migrate.ts said it already did; it stored only filename and applied_at.
 *
 * Uses a scratch database and a scratch migrations directory, so the real
 * ones are untouched. Requires DATABASE_URL (TCP form) for a role that may
 * CREATE DATABASE.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/migrateChecksum.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "pg";
import { runMigrations } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("migrateChecksum.test.ts requires DATABASE_URL (a role that may CREATE DATABASE)");
}
const scratch = `fp_migrate_checksum_${process.pid}`;
function urlFor(database: string): string {
  const u = new URL(databaseUrl!);
  u.pathname = `/${database}`;
  return u.toString();
}
const quiet = () => {};

test("an applied migration that changes afterwards stops the runner; line endings don't count", async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
  await admin.query(`CREATE DATABASE ${scratch}`);
  const dir = mkdtempSync(join(tmpdir(), "fp-migrations-"));
  const client = new Client({ connectionString: urlFor(scratch) });
  await client.connect();
  try {
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int);\n");
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id int);\n");
    assert.equal((await runMigrations(client, dir, quiet)).applied, 2);

    const rows = await client.query<{ filename: string; checksum: string | null }>(
      `SELECT filename, checksum FROM schema_migrations ORDER BY filename`,
    );
    assert.ok(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum ?? "")), "a checksum per file");

    // The same file checked out with CRLF (Windows, core.autocrlf) is not a change.
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int);\r\n");
    assert.equal((await runMigrations(client, dir, quiet)).applied, 0);

    // Editing an applied file is refused, and names the file.
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int); -- edited\n");
    writeFileSync(join(dir, "0003_c.sql"), "CREATE TABLE c (id int);\n");
    await assert.rejects(runMigrations(client, dir, quiet), /0001_a\.sql.*changed/);
    const c = await client.query(`SELECT to_regclass('c') AS t`);
    assert.equal(c.rows[0].t, null, "nothing new was applied once the change was found");
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    await admin.end();
  }
});

test("rows from before checksums existed adopt the current file's checksum once", async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  const name = `${scratch}_old`;
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const dir = mkdtempSync(join(tmpdir(), "fp-migrations-"));
  const client = new Client({ connectionString: urlFor(name) });
  await client.connect();
  try {
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int);\n");
    // The old runner's table: no checksum column.
    await client.query(`CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE a (id int)`);
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ('0001_a.sql')`);

    assert.equal((await runMigrations(client, dir, quiet)).applied, 0);
    const row = await client.query<{ checksum: string | null }>(`SELECT checksum FROM schema_migrations`);
    assert.match(row.rows[0]!.checksum ?? "", /^[0-9a-f]{64}$/);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
