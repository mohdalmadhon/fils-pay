import { randomInt } from "node:crypto";

/*
 * Everything here feeds secrets: OTP login codes (auth/otp.ts) and payment
 * link tokens (paymentLinks/create.ts), which are bearer credentials for a
 * public pay page. They used to come from Math.random(), whose output is
 * predictable from earlier outputs. Now crypto.randomInt, uniform and
 * unpredictable, one digit or character at a time so there is no modulo bias
 * and no float rounding.
 */

/** Generates a string of `n` random decimal digits (e.g. "042817"). */
export function randomDigits(n: number): string {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`randomDigits: n must be a positive integer, got ${n}`);
  }
  let out = "";
  for (let i = 0; i < n; i++) {
    out += String(randomInt(10));
  }
  return out;
}

/** Generates a string of `n` characters drawn uniformly from `alphabet`. */
export function randomFromAlphabet(alphabet: string, n: number): string {
  if (alphabet.length === 0) {
    throw new RangeError("randomFromAlphabet: alphabet must not be empty");
  }
  let out = "";
  for (let i = 0; i < n; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** Short display-only reference for receipts and logs (e.g. "FP-A7K2M3"). */
export function displayReference(): string {
  return `FP-${randomFromAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}`;
}
