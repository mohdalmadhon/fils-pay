import assert from "node:assert/strict";
import test from "node:test";
import { describePayFailure } from "./payError.js";

test("a suspended merchant's refusal ends the checkout instead of asking the customer to refresh", () => {
  const f = describePayFailure(409, { error: "merchant_unavailable" });
  assert.equal(f.kind, "terminal");
  assert.doesNotMatch(f.message, /refresh/i);
  assert.match(f.message, /No payment was taken/);
});

test("a link in flight is still retryable, and other outcomes are unchanged", () => {
  assert.equal(describePayFailure(409, { error: "payment_link_reserved" }).kind, "declined");
  assert.equal(describePayFailure(409, { error: "payment_link_already_paid" }).kind, "terminal");
  assert.equal(describePayFailure(409, { error: "payment_link_canceled" }).kind, "terminal");
  assert.equal(describePayFailure(410, {}).kind, "terminal");
  assert.equal(describePayFailure(402, { stage: "authorize" }).countsAsDecline, true);
  assert.match(describePayFailure(402, { stage: "capture" }).message, /approved/);
  assert.equal(describePayFailure(500, { message: "boom" }).message, "boom");
});

test("a busy API's 503 keeps the form and says nothing was charged", () => {
  const f = describePayFailure(503, { error: "overloaded" });
  assert.equal(f.kind, "declined");
  assert.equal(f.countsAsDecline, false);
  assert.match(f.message, /No payment was taken/);
});

test("a merchant that isn't approved yet ends the checkout with a clear message", () => {
  const f = describePayFailure(403, { error: "merchant_not_approved" });
  assert.equal(f.kind, "terminal");
  assert.equal(f.countsAsDecline, false);
  assert.equal(f.message, "This business can't accept payments yet. No payment was taken.");
});

test("an expired card keeps the form and asks for another card", () => {
  const f = describePayFailure(422, { error: "card_expired", stage: "authorize" });
  assert.equal(f.kind, "declined");
  assert.match(f.message, /expired/);
});
