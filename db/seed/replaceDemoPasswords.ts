#!/usr/bin/env -S npx tsx
/**
 * Replaces the demo data's public passwords on a server that people can
 * reach. The seed gives every seeded merchant user SEED_USER_PASSWORD and
 * every seeded admin SEED_ADMIN_PASSWORD; both are in this repository. On
 * the hosted demo sign-in codes are shown on screen (OTP_SHOW_IN_PRODUCTION,
 * docs/deploy.md), so a password alone signs in, and anyone who read the
 * repo could sign in as the super admin.
 *
 * Every account still using one of those two passwords gets its own new
 * random password, printed once as "<who>: <password>". It used to give one
 * shared password to all merchant users and one to all admins, so whoever
 * was handed a single demo login (say, a support admin) had every other one
 * too, super admin included, and any merchant could sign in as every other
 * merchant. docs/defence/04.
 *
 * Accounts with any other password are not touched, so running it again
 * changes nothing and prints nothing new.
 *
 *   DATABASE_URL=postgres://... npx tsx db/seed/replaceDemoPasswords.ts
 *
 * ops/remote-deploy.sh runs it after a SEED=1 deploy.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import argon2 from "argon2";
import pg from "pg";
import { SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD } from "./generate.js";

// The api's defaults (apps/api/src/config.ts: ARGON2_*), so the hashes are
// the same kind the api writes.
const HASH = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** 16 characters from an unambiguous alphabet, plus a symbol and a digit
 *  so it satisfies the sign-up password rules too. */
export function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}!7`;
}

export interface ReplacedPassword {
  table: "merchant_users" | "admin_users";
  id: string;
  /** "admin superadmin@filspay.test (super_admin)" or
   *  "merchant user owner@x.example at Alpha Retail Co (9972daab-...)" */
  who: string;
  password: string;
}

const ACCOUNTS = {
  merchant_users: {
    publicPassword: SEED_USER_PASSWORD,
    sql: `SELECT u.id, u.password_hash, 'merchant user ' || u.email || ' at ' || m.display_name || ' (' || m.id || ')' AS who
            FROM merchant_users u JOIN merchants m ON m.id = u.merchant_id
           WHERE u.password_hash IS NOT NULL ORDER BY m.display_name, u.email`,
  },
  admin_users: {
    publicPassword: SEED_ADMIN_PASSWORD,
    sql: `SELECT id, password_hash, 'admin ' || email || ' (' || role || ')' AS who
            FROM admin_users WHERE password_hash IS NOT NULL ORDER BY email`,
  },
} as const;

/** Gives every account still on a public demo password its own new one. */
export async function replaceDemoPasswords(client: pg.Client): Promise<ReplacedPassword[]> {
  const replaced: ReplacedPassword[] = [];
  for (const table of ["merchant_users", "admin_users"] as const) {
    const { publicPassword, sql } = ACCOUNTS[table];
    const rows = await client.query<{ id: string; password_hash: string; who: string }>(sql);
    for (const row of rows.rows) {
      if (!(await argon2.verify(row.password_hash, publicPassword).catch(() => false))) continue;
      const password = newPassword();
      await client.query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [await argon2.hash(password, HASH), row.id]);
      replaced.push({ table, id: row.id, who: row.who, password });
    }
  }
  return replaced;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const replaced = await replaceDemoPasswords(client);
    if (replaced.length === 0) {
      console.log("demo passwords: no account uses a public demo password");
      return;
    }
    console.log(`demo passwords: ${replaced.length} account(s) now have their own password (shown once):`);
    for (const r of replaced) console.log(`  ${r.who}: ${r.password}`);
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
