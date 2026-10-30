/**
 * The seed prints one API key per merchant, and the deploy tells people to
 * use them (ops/remote-deploy.sh saves them in seed-output.txt). Every key
 * it prints must work.
 *
 * Before the fix the `seed-deterministic` self-check called generate() a
 * second time, which truncated api_keys and issued (and printed) a second
 * set, so the first set printed was dead. docs/bugs/081-seed-prints-dead-api-keys.md.
 *
 * Requires DATABASE_URL pointing at a Postgres server where the role may
 * CREATE DATABASE. The test creates, migrates, seeds and drops its own
 * throwaway database; the database in DATABASE_URL is only used to connect.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/seed/printedKeys.integration.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("printedKeys.integration.test.ts requires DATABASE_URL (a role that may CREATE DATABASE)");
}

const here = dirname(fileURLToPath(import.meta.url));
const scratchName = `fp_seed_keys_check_${process.pid}`;

function urlFor(database: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${database}`;
  return url.toString();
}

function run(script: string, url: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  delete env.NODE_ENV;
  delete env.SEED_RESET_CONFIRM;
  return execFileSync("npx", ["tsx", script], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

test("every API key the seed prints is a live api_keys row", { timeout: 300_000 }, async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.query(`CREATE DATABASE ${scratchName}`);
  try {
    const url = urlFor(scratchName);
    run(join(here, "..", "migrate.ts"), url);
    const output = run(join(here, "index.ts"), url);
    assert.match(output, /seed: all REAL assertions passed/);

    const printed = [...output.matchAll(/^seed: issued API key for (.+): (\S+)$/gm)].map((m) => ({
      merchant: m[1]!,
      rawKey: m[2]!,
    }));
    assert.ok(printed.length > 0, "the seed printed no API keys");

    const db = new Client({ connectionString: url });
    await db.connect();
    try {
      const live = await db.query<{ n: string }>(`SELECT count(*) AS n FROM api_keys WHERE revoked_at IS NULL`);
      assert.equal(printed.length, Number(live.rows[0]!.n), "one printed key per live key");
      for (const { merchant, rawKey } of printed) {
        const keyHash = createHash("sha256").update(rawKey).digest("hex");
        const row = await db.query<{ display_name: string }>(
          `SELECT m.display_name FROM api_keys k JOIN merchants m ON m.id = k.merchant_id
            WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
          [keyHash],
        );
        assert.equal(row.rows[0]?.display_name, merchant, `printed key for ${merchant} is not a live api_keys row`);
      }
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }
});
