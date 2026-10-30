/**
 * Each demo account gets its own password (docs/defence/04): one shared
 * password per table let a support admin sign in as super admin and any
 * merchant as every other merchant.
 *
 * Requires DATABASE_URL pointing at a Postgres server where the role may
 * CREATE DATABASE; it migrates and drops its own scratch database.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import pg from "pg";
import { SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD } from "./generate.js";
import { replaceDemoPasswords } from "./replaceDemoPasswords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("replaceDemoPasswords.integration.test.ts requires DATABASE_URL");
const here = dirname(fileURLToPath(import.meta.url));
const scratch = `fp_demo_pw_check_${process.pid}`;

test("every account on a public demo password gets its own, and others are untouched", { timeout: 180_000 }, async () => {
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
  await admin.query(`CREATE DATABASE ${scratch}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${scratch}`;
  try {
    execFileSync("npx", ["tsx", join(here, "..", "migrate.ts")], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8" });
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      const userHash = await argon2.hash(SEED_USER_PASSWORD);
      const adminHash = await argon2.hash(SEED_ADMIN_PASSWORD);
      const keptHash = await argon2.hash("someone's own password 1!");
      const m = await db.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ('A', 250), ('B', 250) RETURNING id`);
      for (const [i, row] of m.rows.entries()) {
        await db.query(`INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3), ($1, $4, 'support', $3)`, [
          row.id,
          `owner${i}@x.test`,
          userHash,
          `support${i}@x.test`,
        ]);
      }
      await db.query(`INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, 'kept@x.test', 'finance', $2)`, [m.rows[0]!.id, keptHash]);
      await db.query(
        `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES
           ('support@a.test', $1, 'S', 'support'), ('finance@a.test', $1, 'F', 'finance'), ('super@a.test', $1, 'X', 'super_admin')`,
        [adminHash],
      );

      const replaced = await replaceDemoPasswords(db);
      assert.equal(replaced.length, 7, "4 merchant users and 3 admins");
      assert.equal(new Set(replaced.map((r) => r.password)).size, 7, "every password is different");
      for (const r of replaced) {
        const row = await db.query<{ password_hash: string }>(`SELECT password_hash FROM ${r.table} WHERE id = $1`, [r.id]);
        assert.ok(await argon2.verify(row.rows[0]!.password_hash, r.password), r.who);
        for (const other of replaced.filter((o) => o.id !== r.id)) {
          assert.equal(await argon2.verify(row.rows[0]!.password_hash, other.password), false, `${r.who} opens with another account's password`);
        }
      }
      assert.ok(replaced.some((r) => /^admin super@a\.test \(super_admin\)$/.test(r.who)));
      const kept = await db.query<{ password_hash: string }>(`SELECT password_hash FROM merchant_users WHERE email = 'kept@x.test'`);
      assert.equal(kept.rows[0]!.password_hash, keptHash);
      assert.equal((await replaceDemoPasswords(db)).length, 0, "running it again changes nothing");
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    await admin.end();
  }
});
