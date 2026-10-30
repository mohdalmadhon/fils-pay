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
  const { pan, cvv, expiryMonth, expiryYear } = card;
  if (typeof pan !== "string" || pan.trim() === "") {
    throw new BadRequestError("invalid_card", "card.pan must be the card number as a string");
  }
  if (typeof cvv !== "string") {
    throw new BadRequestError("invalid_card", "card.cvv must be a string");
  }
  if (typeof expiryMonth !== "number" || !Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
    throw new BadRequestError("invalid_card", "card.expiryMonth must be a month from 1 to 12");
  }
  if (typeof expiryYear !== "number" || !Number.isInteger(expiryYear)) {
    throw new BadRequestError("invalid_card", "card.expiryYear must be a whole year");
  }
  return { pan, cvv, expiryMonth, expiryYear };
}
