import assert from "node:assert/strict";
import test from "node:test";
import { cardProblem, isCardExpired, isCvvValid, normalizeExpiryYear } from "./cardChecks.js";

const now = new Date("2026-10-15T12:00:00.000Z");
const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

test("an expired card is caught before it is sent", () => {
  assert.equal(isCardExpired(9, 2026, now), true);
  assert.equal(isCardExpired(10, 2026, now), false, "valid to the end of the month");
  assert.equal(isCardExpired(12, 2025, now), true);
  assert.match(cardProblem({ ...card, expiryMonth: 9, expiryYear: 2026 }, now) ?? "", /expired/);
});

test("a two-digit year means 20YY", () => {
  assert.equal(normalizeExpiryYear(30), 2030);
  assert.equal(normalizeExpiryYear(2030), 2030);
  assert.equal(cardProblem({ ...card, expiryYear: 30 }, now), null);
  assert.equal(isCardExpired(9, 26, now), true);
});

test("the CVV is digits only: 3, or 4 for American Express", () => {
  assert.equal(isCvvValid("123", card.pan), true);
  assert.equal(isCvvValid("12a", card.pan), false);
  assert.equal(isCvvValid("1234", card.pan), false);
  assert.equal(isCvvValid("1234", "378282246310005"), true);
  assert.equal(isCvvValid("123", "378282246310005"), false);
  assert.equal(cardProblem(card, now), null);
});
