/**
 * Sign-in throttling, shared by the merchant and admin planes. Backed by
 * auth_failures (0078) so every API instance sees the same counts.
 *
 * - recordAuthFailure: one row per failed password check or wrong OTP.
 * - assertLoginAllowed: before a password is even checked, refuse with 429
 *   when the account (or, if enabled, the client IP) has reached its limit
 *   within the window. The check runs whether or not the account exists, and
 *   the right password doesn't bypass it.
 */
import type { Pool, PoolClient } from "pg";
import type { Config } from "../config.js";
import { sha256Hex } from "../lib/crypto.js";
import { TooManyRequestsError } from "../lib/errors.js";

export type AuthPlane = "merchant" | "admin";

type ThrottleConfig = Pick<Config, "loginMaxFailures" | "loginMaxFailuresPerIp" | "loginFailureWindowMinutes">;

/** Same key whether or not the account exists. Emails compare as typed at
 *  login (the lookup is exact), lower-cased here so case variants share one
 *  budget. */
export function merchantAccountKey(merchantId: string, email: string): string {
  return sha256Hex(`merchant:${merchantId}:${email.trim().toLowerCase()}`);
}

export function adminAccountKey(email: string): string {
  return sha256Hex(`admin:${email.trim().toLowerCase()}`);
}

export async function assertLoginAllowed(
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

export async function recordAuthFailure(
  db: Pool | PoolClient,
  config: Pick<Config, "loginFailureWindowMinutes">,
  entry: { plane: AuthPlane; kind: "password" | "otp"; accountKey: string; ipAddress: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO auth_failures (plane, kind, account_key, ip_address) VALUES ($1, $2, $3, $4)`,
    [entry.plane, entry.kind, entry.accountKey, entry.ipAddress],
  );
  // Keep the table small: rows past the window are never needed again.
  // Cheap with the created_at-ordered indexes; failures are rare.
  await db.query(
    `DELETE FROM auth_failures WHERE created_at < now() - make_interval(mins => $1 * 4)`,
    [config.loginFailureWindowMinutes],
  );
}
