/** hashRequest refuses card numbers, CVVs and passwords. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashRequest } from "./idempotency.js";

test("sensitive fields are refused at any depth", () => {
  assert.throws(() => hashRequest({ card: { pan: "4242424242424242" } }), /pan/);
  assert.throws(() => hashRequest({ card: { cvv: "123" } }), /cvv/);
  assert.throws(() => hashRequest({ items: [{ password: "x" }] }), /password/);
});

test("ordinary bodies hash as before", () => {
  assert.equal(hashRequest({ b: 1, a: 2 }), hashRequest({ a: 2, b: 1 }));
  assert.match(hashRequest({ amountFils: 1 }), /^[0-9a-f]{64}$/);
});
