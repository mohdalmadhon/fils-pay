/**
 * Limits on public signup (POST /v1/merchants), docs/improvements/11.
 *
 * Counts recent signups for the owner email (lower-cased, hashed) and, if
 * enabled, the client IP, under a per-email advisory lock so parallel
 * requests can't all pass the count, and records this one. Signup used to
 * have no limit at all.
 */
import type { Pool } from "pg";
import type { Config } from "../config.js";
import { withTransaction } from "../db/withTransaction.js";
import { sha256Hex } from "../lib/crypto.js";
import { TooManyRequestsError } from "../lib/errors.js";

export async function reserveSignup(
  pool: Pool,
  config: Pick<Config, "signupMaxPerEmail" | "signupMaxPerIp" | "signupWindowMinutes">,
  email: string,
  ipAddress: string | null,
): Promise<void> {
  const emailKey = sha256Hex(`signup:${email.trim().toLowerCase()}`);
  await withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [emailKey]);
    const ip = config.signupMaxPerIp > 0 ? ipAddress : null;
    const counts = await client.query<{ by_email: string; by_ip: string }>(
      `SELECT count(*) FILTER (WHERE email_key = $1) AS by_email,
              count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_address = $2) AS by_ip
         FROM signup_attempts
        WHERE created_at > now() - make_interval(mins => $3)
          AND (email_key = $1 OR ($2::text IS NOT NULL AND ip_address = $2))`,
      [emailKey, ip, config.signupWindowMinutes],
    );
    const row = counts.rows[0];
    if (
      Number(row?.by_email ?? 0) >= config.signupMaxPerEmail ||
      (config.signupMaxPerIp > 0 && Number(row?.by_ip ?? 0) >= config.signupMaxPerIp)
    ) {
      throw new TooManyRequestsError("too_many_signups");
    }
    await client.query(`INSERT INTO signup_attempts (email_key, ip_address) VALUES ($1, $2)`, [emailKey, ipAddress]);
  });
}
