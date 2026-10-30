import { toFils, type Fils } from "@filspay/money";
import type { SimulatedCardInput } from "../acquirer/types.js";
import { BadRequestError } from "./errors.js";

/**
 * Request-body checks shared by the routes that move card money
 * (authorize, capture, payment-link pay). Anything malformed is a 400
 * before any business logic runs; without these, a negative, fractional,
 * string or zero amount, or a card without a number, reached toFils(), the
 * acquirer or a database CHECK and came back as a 500. docs/bugs/008.
 */

/** A whole, positive number of fils. */
export function parsePositiveFils(value: unknown, field: string): Fils {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestError("invalid_request", `${field} must be a positive whole number of fils`);
  }
  return toFils(value);
}

/** The shape of a card: a number and CVV as strings, a real month, a whole year. */
export function parseCardInput(value: unknown): SimulatedCardInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError("invalid_request", "card is required");
  }
  const card = value as Record<string, unknown>;
  const { cvv, expiryMonth, expiryYear } = card;
  // Digits only, 12 to 19 of them; spaces and dashes as people type them are
  // dropped. It used to accept any string, a NUL byte or letters included,
  // and pass it to the acquirer as it was. docs/defence/08.
  const pan = typeof card.pan === "string" ? card.pan.replace(/[\s-]/g, "") : null;
  if (pan === null || !/^\d{12,19}$/.test(pan)) {
    throw new BadRequestError("invalid_card", "card.pan must be the card number: 12 to 19 digits");
  }
  if (typeof cvv !== "string" || !/^\d{3,4}$/.test(cvv)) {
    throw new BadRequestError("invalid_card", "card.cvv must be 3 or 4 digits");
  }
  if (typeof expiryMonth !== "number" || !Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
    throw new BadRequestError("invalid_card", "card.expiryMonth must be a month from 1 to 12");
  }
  if (typeof expiryYear !== "number" || !Number.isInteger(expiryYear)) {
    throw new BadRequestError("invalid_card", "card.expiryYear must be a whole year");
  }
  return { pan, cvv, expiryMonth, expiryYear };
}

/**
 * An optional merchant reference: a string of at most 255 characters with no
 * control characters. A non-string used to be stored as its JSON text, and a
 * NUL byte reached Postgres and came back as a 500. docs/defence/08.
 */
export function parseReference(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestError("invalid_request", "reference must be text of at most 255 characters, without control characters");
  }
  return value;
}
