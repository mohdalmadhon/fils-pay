/**
 * Sign-in throttling, shared by the merchant and admin planes. Backed by
 * auth_failures (0078) so every API instance sees the same counts.
 *
 * - reserveLoginAttempt: before a password is checked, under a per-account
 *   advisory lock, refuse with 429 when the account (or, if enabled, the
 *   client IP) has reached its limit, otherwise record this attempt as a
 *   failure up front. Counting and recording under one lock means a burst of
 *   parallel requests can't all pass the count before any is recorded.
 *   The check runs whether or not the account exists, and the right password
 *   doesn't bypass it.
 * - releaseLoginAttempt: the password was right, so the reserved row is
 *   removed and a correct login never uses up the budget.
 * - recordAuthFailure: one row per wrong OTP code.
 */
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { canonicalUuid } from "../lib/uuid.js";
import type { Config } from "../config.js";
import { sha256Hex } from "../lib/crypto.js";
import { TooManyRequestsError } from "../lib/errors.js";

export type AuthPlane = "merchant" | "admin";

type ThrottleConfig = Pick<Config, "loginMaxFailures" | "loginMaxFailuresPerIp" | "loginFailureWindowMinutes">;

/** Same key whether or not the account exists. Emails compare as typed at
 *  login (the lookup is exact), lower-cased here so case variants share one
 *  budget. */
/** The merchant id in its one canonical spelling, or null. Each spelling
 *  Postgres accepts used to get its own failure budget. */
export function canonicalMerchantId(raw: unknown): string | null {
  return canonicalUuid(raw);
}

/** Call with a canonical merchant id (canonicalMerchantId). */
export function merchantAccountKey(merchantId: string, email: string): string {
  return sha256Hex(`merchant:${merchantId}:${email.trim().toLowerCase()}`);
}

export function adminAccountKey(email: string): string {
  return sha256Hex(`admin:${email.trim().toLowerCase()}`);
}

async function countRecentFailures(
  db: Pool | PoolClient,
  config: ThrottleConfig,
  accountKey: string,
  ipAddress: string | null,
): Promise<void> {
  const result = await db.query<{ by_account: string; by_ip: string }>(
    `SELECT
       count(*) FILTER (WHERE account_key = $1) AS by_account,
       count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_address = $2) AS by_ip
       FROM auth_failures
      WHERE created_at > now() - make_interval(mins => $3)
        AND (account_key = $1 OR ($2::text IS NOT NULL AND ip_address = $2))`,
    [accountKey, config.loginMaxFailuresPerIp > 0 ? ipAddress : null, config.loginFailureWindowMinutes],
  );
  const row = result.rows[0];
  const byAccount = Number(row?.by_account ?? 0);
  const byIp = Number(row?.by_ip ?? 0);
  if (byAccount >= config.loginMaxFailures || (config.loginMaxFailuresPerIp > 0 && byIp >= config.loginMaxFailuresPerIp)) {
    throw new TooManyRequestsError("too_many_login_attempts");
  }
}

/** Checks the limit and records this attempt as a failure, atomically per
 *  account. Returns the row id; pass it to releaseLoginAttempt when the
 *  password turns out to be right. */
export async function reserveLoginAttempt(
  pool: Pool,
  config: ThrottleConfig,
  entry: { plane: AuthPlane; accountKey: string; ipAddress: string | null },
): Promise<string> {
  const id = await withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [entry.accountKey]);
    await countRecentFailures(client, config, entry.accountKey, entry.ipAddress);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auth_failures (plane, kind, account_key, ip_address) VALUES ($1, 'password', $2, $3) RETURNING id`,
      [entry.plane, entry.accountKey, entry.ipAddress],
    );
    return inserted.rows[0]!.id;
  });
  await pruneOldFailures(pool, config);
  return id;
}

/**
 * Throws 429 too_many_login_attempts when the account (or the address) is
 * over its failure limit, without recording anything. The OTP step calls it
 * before comparing a code, so a code can't be tried once the account has
 * hit the limit, whichever pending sign-in it comes through.
 * docs/defence/01.
 */
export async function assertUnderLoginLimit(
  db: Pool | PoolClient,
  config: ThrottleConfig,
  entry: { accountKey: string; ipAddress: string | null },
): Promise<void> {
  await countRecentFailures(db, config, entry.accountKey, entry.ipAddress);
}

export async function releaseLoginAttempt(db: Pool | PoolClient, attemptId: string): Promise<void> {
  await db.query(`DELETE FROM auth_failures WHERE id = $1`, [attemptId]);
}

async function pruneOldFailures(db: Pool | PoolClient, config: Pick<Config, "loginFailureWindowMinutes">): Promise<void> {
  // Rows past the window are never needed again (idx_auth_failures_created).
  await db.query(`DELETE FROM auth_failures WHERE created_at < now() - make_interval(mins => $1 * 4)`, [
    config.loginFailureWindowMinutes,
  ]);
}

export async function recordAuthFailure(
  db: Pool | PoolClient,
  config: Pick<Config, "loginFailureWindowMinutes">,
  entry: { plane: AuthPlane; kind: "password" | "otp"; accountKey: string; ipAddress: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO auth_failures (plane, kind, account_key, ip_address) VALUES ($1, $2, $3, $4)`,
    [entry.plane, entry.kind, entry.accountKey, entry.ipAddress],
  );
  await pruneOldFailures(db, config);
}
