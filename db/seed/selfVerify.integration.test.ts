/**
 * The seed's self-verify assertions (selfVerify.ts) against a real seeded
 * database: all pass on the seed, and a broken row makes the matching one
 * fail.
 *
 * Before the fix this file never called buildAssertions/runAssertions: it
 * filled its own temp tables with synthetic rows and checked its own
 * arithmetic, so it passed whatever the seed or the assertions did, and no
 * test script ran it. docs/bugs/087-tests-that-cannot-fail.md.
 *
 * Requires DATABASE_URL pointing at a Postgres server where the role may
 * CREATE DATABASE (and WEBHOOK_SECRET_ENCRYPTION_KEY, which the seed's
 * config needs). The test creates, seeds and drops its own database.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/seed/selfVerify.integration.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { generate } from "./generate.js";
import { buildAssertions, runAssertions } from "./selfVerify.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("selfVerify.integration.test.ts requires DATABASE_URL (a role that may CREATE DATABASE)");
}
const here = dirname(fileURLToPath(import.meta.url));
const scratchName = `fp_self_verify_check_${process.pid}`;

test("every REAL self-verify assertion passes on the seed, and fails on a broken row", { timeout: 300_000 }, async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.query(`CREATE DATABASE ${scratchName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${scratchName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 5 });
  const log = console.log;
  const lines: string[] = [];
  try {
    execFileSync("npx", ["tsx", join(here, "..", "migrate.ts")], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: "utf8",
    });
    const summary = await generate(pool);
    const assertions = buildAssertions(pool, { initialLedgerChecksum: summary.ledgerChecksum });
    assert.ok(assertions.some((a) => a.id === "seed-deterministic" && a.status === "real"));

    console.log = (line: string) => lines.push(line);
    assert.equal(await runAssertions(assertions), true, lines.join("\n"));
    console.log = log;
    assert.equal(lines.filter((l) => l.startsWith("REAL   PASS")).length, assertions.filter((a) => a.status === "real").length);

    // The schema itself refuses captured > authorized; lift that in this
    // throwaway database so the assertion has something to catch.
    await pool.query(`ALTER TABLE transactions DROP CONSTRAINT transactions_check`);
    await pool.query(`UPDATE transactions SET captured_fils = amount_fils + 1
                       WHERE id = (SELECT id FROM transactions ORDER BY id LIMIT 1)`);
    const capturedCheck = assertions.find((a) => a.id === "captured-le-authorized")!;
    assert.deepEqual(await capturedCheck.run(), { pass: false, detail: "1 violating row(s)" });
  } finally {
    console.log = log;
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }
});
