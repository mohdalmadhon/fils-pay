import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the signature on an inbound acquirer callback.
 *
 * The acquirer signs `${t}.${rawBody}` with HMAC-SHA256 and sends
 * `Acquirer-Callback-Signature: t=<unix seconds>,v1=<hex>`. The signature is
 * checked over the request body **exactly as it arrived** — never over a
 * re-serialized copy of the parsed JSON, which can differ byte-for-byte
 * (whitespace, key order, number formatting, unicode escapes) and makes
 * genuine callbacks fail verification.
 */

interface ParsedAcquirerSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseAcquirerSignatureHeader(header: string): ParsedAcquirerSignatureHeader | null {
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
  // HMAC-SHA256 hex is exactly 64 hex characters; anything else can't match.
  if (!/^[0-9a-f]{64}$/i.test(signature)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature: signature.toLowerCase() };
}

export type VerifyAcquirerCallbackFailureReason =
  | "malformed_header"
  | "signature_mismatch"
  | "signing_secret_not_configured"
  | "timestamp_out_of_tolerance";

export interface VerifyAcquirerCallbackOptions {
  /** Max distance between the signed timestamp and now, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in unix seconds (test seam). Defaults to the real clock. */
  now?: number;
}

export interface VerifyAcquirerCallbackResult {
  valid: boolean;
  reason?: VerifyAcquirerCallbackFailureReason;
}

/**
 * Verifies an acquirer callback signature. A signature is required unless
 * the caller explicitly passes `requireSignature = false` (non-production
 * only — see config.ts), and its timestamp must be within the tolerance
 * window, so a captured callback can't be replayed later.
 *
 * @param body The raw request body string. A non-string value is accepted for
 *   callers that only hold a parsed object, and is serialized with
 *   JSON.stringify — only correct if the sender produced exactly that string.
 */
export function verifyAcquirerCallbackSignature(
  body: unknown,
  header: string | undefined,
  secret: string,
  requireSignature = true,
  options: VerifyAcquirerCallbackOptions = {},
): VerifyAcquirerCallbackResult {
  if (!header) {
    return requireSignature ? { valid: false, reason: "malformed_header" } : { valid: true };
  }

  // An HMAC keyed with an empty secret can be computed by anyone, so it
  // proves nothing. Never accept a signature against an unconfigured secret.
  if (secret === "") return { valid: false, reason: "signing_secret_not_configured" };

  const parsed = parseAcquirerSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest();
  const presented = Buffer.from(parsed.signature, "hex");

  // Both are 32 bytes here (the header format check guarantees it), so the
  // comparison is constant-time over the full digest.
  if (!timingSafeEqual(expected, presented)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  // Checked after the HMAC, so an unauthenticated caller learns nothing
  // about the window. The timestamp is inside the MAC, so it can't be edited.
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  return { valid: true };
}
