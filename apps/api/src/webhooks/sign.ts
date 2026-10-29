import { createHmac } from "node:crypto";
import { canonicalJson } from "../payments/idempotency.js";
import { timingSafeEqualHex } from "../lib/crypto.js";

/**
 * Webhook signing: a timestamped Stripe-`t=...,v1=...`-style HMAC-SHA256
 * over the exact request body, and a constant-time comparison when
 * verifying.
 *
 * The rule that matters: **the bytes that are signed are the bytes that are
 * sent.** `signPayload` serializes the payload once (canonical, key-sorted
 * JSON) and returns that string as `body` next to the signature. Callers must
 * send `body` verbatim and never re-serialize the payload themselves. A
 * receiver then verifies HMAC(secret, `${t}.${rawBody}`) over exactly what it
 * received, with no JSON parsing or re-serialization on its side.
 *
 * — YA: wrote this one slowly. read it before copying it.
 */

export interface SignedPayload {
  /** unix seconds, the value folded into the signature */
  timestamp: number;
  /** header value: "t=<timestamp>,v1=<hex-hmac-sha256>" */
  signature: string;
  /** The exact request body that was signed. Send this string verbatim. */
  body: string;
}

/** HMAC-SHA256 hex over `${timestamp}.${body}`. */
function hmacHex(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Serializes `payload` and signs the result. `secret` is the raw (decrypted)
 * webhook secret — callers decrypt webhook_endpoints.secret_ciphertext
 * (webhooks/secretCrypto.ts) first; sign.ts never touches encryption.
 *
 * The timestamp is part of the signed string, so a receiver can enforce a
 * freshness window using only what's in the header — a captured genuine
 * delivery can't be replayed later with a signature that still looks fresh.
 */
export function signPayload(
  payload: unknown,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): SignedPayload {
  const body = canonicalJson(payload);
  return { timestamp, signature: `t=${timestamp},v1=${hmacHex(body, secret, timestamp)}`, body };
}

interface ParsedSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === "t") timestampStr = value;
    else if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) return null;
  if (!/^\d+$/.test(timestampStr)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature };
}

export type VerifySignatureFailureReason = "malformed_header" | "signature_mismatch" | "timestamp_out_of_tolerance";

export interface VerifySignatureResult {
  valid: boolean;
  reason?: VerifySignatureFailureReason;
}

/**
 * Verifies a signature header against the raw request body, exactly as a
 * merchant's receiver should: HMAC over the bytes received, compared in
 * constant time (`timingSafeEqualHex`, never `===`), then the freshness
 * window. This is the function to point merchants and the "test your
 * webhook secret" tooling at.
 */
export function verifyRawBody(
  rawBody: string,
  header: string,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): VerifySignatureResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  if (!timingSafeEqualHex(hmacHex(rawBody, secret, parsed.timestamp), parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options?.toleranceSeconds ?? 300;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  return { valid: true };
}

/**
 * Verifies a header against an already-parsed payload object by
 * re-serializing it the same way `signPayload` does. Only correct for
 * bodies this module produced; a receiver holding the raw body must use
 * `verifyRawBody` instead.
 */
export function verifySignature(
  payload: unknown,
  header: string,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): VerifySignatureResult {
  return verifyRawBody(canonicalJson(payload), header, secret, options);
}
