import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { timingSafeEqualHex } from "../lib/crypto.js";
import { randomDigits } from "../lib/random.js";

/** e.g. generateOtpCode(6) => "042817". */
export function generateOtpCode(length: number): string {
  return randomDigits(length);
}

/**
 * Hashes an OTP code with its per-challenge salt. `code_salt` is a fresh
 * random value per challenge, so the stored `code_hash` is not a bare,
 * unsalted sha256 of a small code space (which would be trivially
 * rainbow-tabled). The raw code is never persisted; it exists only in
 * memory long enough to hash it and hand it to the notifier.
 */
export function hashOtpCode(code: string, salt: string): string {
  return createHash("sha256").update(salt + code).digest("hex");
}

/** Constant-time match of a user-supplied code against a stored challenge. */
export function verifyOtpCode(inputCode: string, salt: string, expectedHash: string): boolean {
  return timingSafeEqualHex(hashOtpCode(inputCode, salt), expectedHash);
}

/** Which challenge table a verify runs against. Fixed strings, never input. */
export type OtpChallengeTable = "otp_challenges" | "admin_otp_challenges";

export type OtpAttemptResult =
  | { outcome: "matched" }
  | { outcome: "invalid_code" }
  | { outcome: "expired" }
  | { outcome: "too_many_attempts" };

/**
 * Checks one guess against a challenge, spending one attempt first.
 *
 * The attempt is claimed with a single conditional UPDATE (still unconsumed,
 * unexpired, attempts left) before the code is compared. The old flow read
 * attempt_count, compared, and only incremented after a miss, so any number
 * of guesses sent at once all read the same count and were all checked: the
 * 5-attempt limit only held for guesses sent one at a time.
 *
 * A match then consumes the challenge with `consumed_at IS NULL` in the
 * WHERE clause, so a correct code can be used once even when two requests
 * carry it at the same time. That consume runs on `consumeWith`, so the
 * caller can make it part of the transaction that promotes the session.
 */
export async function attemptOtp(
  db: Pool | PoolClient,
  table: OtpChallengeTable,
  challengeId: string,
  inputCode: string,
): Promise<OtpAttemptResult> {
  const claimed = await db.query<{ code_salt: string; code_hash: string }>(
    `UPDATE ${table}
        SET attempt_count = attempt_count + 1
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() AND attempt_count < max_attempts
      RETURNING code_salt, code_hash`,
    [challengeId],
  );
  const row = claimed.rows[0];
  if (!row) {
    const state = await db.query<{ exhausted: boolean; dead: boolean }>(
      `SELECT attempt_count >= max_attempts AS exhausted, (consumed_at IS NOT NULL OR expires_at <= now()) AS dead
         FROM ${table} WHERE id = $1`,
      [challengeId],
    );
    const s = state.rows[0];
    if (!s || s.dead) return { outcome: "expired" };
    return { outcome: "too_many_attempts" };
  }
  return verifyOtpCode(inputCode, row.code_salt, row.code_hash) ? { outcome: "matched" } : { outcome: "invalid_code" };
}

/** Marks a matched challenge used. False if another request used it first. */
export async function consumeOtpChallenge(
  client: PoolClient,
  table: OtpChallengeTable,
  challengeId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE ${table} SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [challengeId],
  );
  return (result.rowCount ?? 0) === 1;
}

export interface IssuedOtpChallenge {
  id: string;
  code: string;
  expiresAt: Date;
}

/**
 * Inserts a fresh `otp_challenges` row inside the caller's open transaction
 * and returns the raw code (never stored) so the caller can hand it to the
 * notifier / dev-expose response field.
 */
export async function issueChallenge(
  client: PoolClient,
  params: {
    merchantUserId: string;
    ttlMinutes: number;
    codeLength: number;
    maxAttempts: number;
    /** Guesses already spent on the challenge this one replaces (resend). */
    attemptCount?: number;
  },
): Promise<IssuedOtpChallenge> {
  const code = generateOtpCode(params.codeLength);
  const salt = randomBytes(16).toString("hex");
  const hash = hashOtpCode(code, salt);
  const expiresAt = new Date(Date.now() + params.ttlMinutes * 60_000);

  const result = await client.query<{ id: string }>(
    `INSERT INTO otp_challenges (merchant_user_id, code_salt, code_hash, expires_at, max_attempts, attempt_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [params.merchantUserId, salt, hash, expiresAt, params.maxAttempts, params.attemptCount ?? 0],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("issueChallenge: insert into otp_challenges returned no row");
  }
  return { id: row.id, code, expiresAt };
}
