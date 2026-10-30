/**
 * ops/db/service-roles.sql gives each service only what it needs
 * (docs/improvements/13). Builds a scratch database, migrates it, applies
 * the script with psql, then connects as each role and checks what it can
 * and can't do.
 *
 * Requires DATABASE_URL (TCP form, postgres://user:pass@host:port/db) for a
 * role that may CREATE DATABASE and CREATE ROLE, and psql on PATH. Roles are
 * cluster-wide; the test leaves them in place (the script is idempotent).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("serviceRoles.integration.test.ts requires DATABASE_URL (a role that may CREATE DATABASE and CREATE ROLE)");
}
const scratch = `fp_roles_check_${process.pid}`;

/** psql applies the script; skip (not fail) where it isn't installed, e.g. a
 *  Windows laptop. CI has it. */
function psqlAvailable(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const PASSWORDS = { api: "api-test-pw", settlement: "settlement-test-pw", reporting: "reporting-test-pw" };

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(databaseUrl!);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = password ?? "";
  }
  return u.toString();
}

async function asRole<T>(role: keyof typeof PASSWORDS, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: urlFor(scratch, `filspay_${role}`, PASSWORDS[role]) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function denied(role: keyof typeof PASSWORDS, sql: string): Promise<void> {
  await asRole(role, async (c) => {
    await assert.rejects(c.query(sql), /permission denied|must be owner/, `${role} should not be allowed: ${sql}`);
  });
}

async function allowed(role: keyof typeof PASSWORDS, sql: string): Promise<void> {
  await asRole(role, async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(sql);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

test("each service role can do its job and nothing more", { timeout: 180_000, skip: !psqlAvailable() && "psql not on PATH" }, async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
  await admin.query(`CREATE DATABASE ${scratch}`);
  try {
    execFileSync("npx", ["tsx", "db/migrate.ts"], { env: { ...process.env, DATABASE_URL: urlFor(scratch) }, stdio: "pipe" });
    execFileSync(
      "psql",
      [
        urlFor(scratch),
        "-q",
        "-v", `api_password=${PASSWORDS.api}`,
        "-v", `settlement_password=${PASSWORDS.settlement}`,
        "-v", `reporting_password=${PASSWORDS.reporting}`,
        "-f", "ops/db/service-roles.sql",
      ],
      { stdio: "pipe" },
    );

    // Nobody but the owner can change the schema or empty the core tables.
    for (const role of ["api", "settlement", "reporting"] as const) {
      await denied(role, `DROP TABLE ledger_entries`);
      await denied(role, `TRUNCATE merchants`);
      await denied(role, `DELETE FROM ledger_entries`);
      await denied(role, `UPDATE ledger_entries SET amount_fils = amount_fils`);
    }
    await denied("api", `DELETE FROM schema_migrations`);

    // api: normal reads and writes.
    await allowed("api", `INSERT INTO merchants (display_name, mdr_bps) VALUES ('roles check', 250)`);
    await allowed("api", `TRUNCATE merchant_daily_volume`);

    // settlement: its writes, but not the api's tables.
    await allowed("settlement", `UPDATE platform_stats SET updated_at = now() WHERE id = 1`);
    await allowed("settlement", `SELECT * FROM settlement_batches FOR UPDATE`);
    await denied("settlement", `UPDATE merchant_users SET role = 'owner'`);
    await denied("settlement", `DELETE FROM api_keys`);

    // reporting: reads the outbox, writes rollups, touches nothing else.
    await allowed("reporting", `SELECT * FROM outbox_events LIMIT 1`);
    await allowed("reporting", `TRUNCATE merchant_daily_volume`);
    await denied("reporting", `SELECT * FROM merchant_users`);
    await denied("reporting", `SELECT * FROM api_keys`);
    await denied("reporting", `INSERT INTO ledger_entries (entry_group_id) VALUES (gen_random_uuid())`);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    await admin.end();
  }
});
