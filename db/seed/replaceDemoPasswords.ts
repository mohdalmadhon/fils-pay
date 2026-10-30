#!/usr/bin/env -S npx tsx
/**
 * Replaces the demo data's public passwords on a server that people can
 * reach. The seed gives every seeded merchant user SEED_USER_PASSWORD and
 * every seeded admin SEED_ADMIN_PASSWORD; both are in this repository. On
 * the hosted demo sign-in codes are shown on screen (OTP_SHOW_IN_PRODUCTION,
 * docs/deploy.md), so a password alone signs in, and anyone who read the
 * repo could sign in as the super admin.
 *
 * Every account still using one of those two passwords gets a new random
 * one (one for the merchant users, one for the admins), printed once.
 * Accounts with any other password are not touched, so running it again
 * changes nothing and prints nothing new.
 *
 *   DATABASE_URL=postgres://... npx tsx db/seed/replaceDemoPasswords.ts
 *
 * ops/remote-deploy.sh runs it after a SEED=1 deploy.
 */
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD } from "./generate.js";

// The api's defaults (apps/api/src/config.ts: ARGON2_*), so the hashes are
// the same kind the api writes.
const HASH = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** 16 characters from an unambiguous alphabet, plus a symbol and a digit
 *  so it satisfies the sign-up password rules too. */
function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}!7`;
}

async function stillPublic(client: pg.Client, table: "merchant_users" | "admin_users", publicPassword: string) {
  const rows = await client.query<{ id: string; email: string; password_hash: string | null }>(
    `SELECT id, email, password_hash FROM ${table} WHERE password_hash IS NOT NULL`,
  );
  const matches: Array<{ id: string; email: string }> = [];
  for (const row of rows.rows) {
    if (row.password_hash && (await argon2.verify(row.password_hash, publicPassword).catch(() => false))) {
      matches.push({ id: row.id, email: row.email });
    }
  }
  return matches;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const [table, publicPassword, label] of [
      ["merchant_users", SEED_USER_PASSWORD, "merchant users"],
      ["admin_users", SEED_ADMIN_PASSWORD, "admins"],
    ] as const) {
      const accounts = await stillPublic(client, table, publicPassword);
      if (accounts.length === 0) {
        console.log(`demo passwords: no ${label} use the public demo password`);
        continue;
      }
      const password = newPassword();
      const hash = await argon2.hash(password, HASH);
      await client.query(`UPDATE ${table} SET password_hash = $1 WHERE id = ANY($2::uuid[])`, [
        hash,
        accounts.map((a) => a.id),
      ]);
      console.log(`demo passwords: new password for ${accounts.length} ${label}: ${password}`);
      for (const a of accounts) console.log(`  ${a.email}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
