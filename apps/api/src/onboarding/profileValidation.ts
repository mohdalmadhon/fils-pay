import { BadRequestError } from "../lib/errors.js";

export const BUSINESS_TYPES = ["sole_proprietorship", "llc", "partnership", "public_company", "other"] as const;

/** Columns that are NOT NULL in merchant_business_profiles. */
const REQUIRED_TEXT_FIELDS = [
  "legalName",
  "registrationNumber",
  "contactEmail",
  "contactPhone",
  "addressLine1",
  "city",
] as const;

/** Columns that may be null. */
const OPTIONAL_TEXT_FIELDS = ["addressLine2", "postalCode"] as const;

/** Deliberately loose: one @, something on both sides, a dot in the domain,
 *  no spaces. The OTP at login is what proves the address works. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trims an email and checks its shape. Case is kept as typed: login matches
 * merchant_users.email exactly (routes/auth.ts), so lower-casing here would
 * lock out someone who signed up as "Ali@..." and logs in the same way.
 */
export function normalizeEmail(value: unknown, field: string): string {
  if (typeof value !== "string" || !EMAIL_RE.test(value.trim())) {
    throw new BadRequestError("invalid_email", `${field} must be an email address`);
  }
  return value.trim();
}

/**
 * Checks business-profile fields from client JSON before they reach the
 * table's CHECK, CHAR(2) and NOT NULL rules (which would answer with a 500),
 * and returns them trimmed. With `partial`, absent fields are left out (a
 * PATCH); otherwise every required field must be present (signup).
 */
export function validateBusinessProfileFields(
  input: Record<string, unknown>,
  { partial }: { partial: boolean },
): Record<string, string | null> {
  const out: Record<string, string | null> = {};

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = input[field];
    if (value === undefined && partial) continue;
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadRequestError("invalid_request", `${field} is required and must be a non-empty string`);
    }
    out[field] = field === "contactEmail" ? normalizeEmail(value, field) : value.trim();
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null) {
      out[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      throw new BadRequestError("invalid_request", `${field} must be a string or null`);
    }
    out[field] = value.trim() === "" ? null : value.trim();
  }

  const businessType = input.businessType;
  if (businessType !== undefined || !partial) {
    if (typeof businessType !== "string" || !(BUSINESS_TYPES as readonly string[]).includes(businessType)) {
      throw new BadRequestError("invalid_business_type", `businessType must be one of ${BUSINESS_TYPES.join(", ")}`);
    }
    out.businessType = businessType;
  }

  // Optional at signup (defaults to BH); in a PATCH it can't be cleared.
  const country = input.country;
  if (country !== undefined) {
    if (typeof country !== "string" || !/^[A-Za-z]{2}$/.test(country.trim())) {
      throw new BadRequestError("invalid_country", "country must be a two-letter ISO country code, e.g. BH");
    }
    out.country = country.trim().toUpperCase();
  }

  return out;
}
