import { formatCardBrandHint } from "../../utils/helpers.js";
import type { SimulatedCardInput } from "../../types.js";

/**
 * Checks the checkout runs before sending a card. The API checks expiry too
 * (apps/api/src/payments/authorize.ts, 422 card_expired); these give the
 * customer the answer straight away and in plain words.
 */

/** A two-digit year (26) means 2026. Four-digit years are unchanged. */
export function normalizeExpiryYear(year: number): number {
  return Number.isInteger(year) && year >= 0 && year < 100 ? 2000 + year : year;
}

/** A card is valid to the end of its expiry month (Asia/Bahrain time, UTC+3). */
export function isCardExpired(expiryMonth: number, expiryYear: number, now: Date = new Date()): boolean {
  const year = normalizeExpiryYear(expiryYear);
  const bahrain = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const currentYear = bahrain.getUTCFullYear();
  const currentMonth = bahrain.getUTCMonth() + 1;
  return year < currentYear || (year === currentYear && expiryMonth < currentMonth);
}

/** Digits only: 4 for American Express, 3 for every other card. */
export function isCvvValid(cvv: string, pan: string): boolean {
  const length = formatCardBrandHint(pan) === "amex" ? 4 : 3;
  return new RegExp(`^\\d{${length}}$`).test(cvv);
}

/** What is wrong with the card, in words for the customer, or null. */
export function cardProblem(card: SimulatedCardInput, now: Date = new Date()): string | null {
  if (!Number.isInteger(card.expiryMonth) || card.expiryMonth < 1 || card.expiryMonth > 12) {
    return "Enter the expiry month as a number from 1 to 12.";
  }
  if (isCardExpired(card.expiryMonth, card.expiryYear, now)) {
    return "This card has expired. Check the date or use another card.";
  }
  if (!isCvvValid(card.cvv, card.pan)) {
    return formatCardBrandHint(card.pan) === "amex"
      ? "Enter the 4-digit security code from the front of the card."
      : "Enter the 3-digit security code from the back of the card.";
  }
  return null;
}
