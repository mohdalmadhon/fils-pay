/** Pure. docs/defence/03. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttemptLimiter } from "./attemptLimiter.js";

test("allows max attempts per key in the window, then refuses until they age out", () => {
  const l = createAttemptLimiter({ max: 3, windowMs: 60_000 });
  assert.equal(l.tryAttempt("a", 0), true);
  assert.equal(l.tryAttempt("a", 1_000), true);
  assert.equal(l.tryAttempt("a", 2_000), true);
  assert.equal(l.tryAttempt("a", 3_000), false);
  assert.equal(l.tryAttempt("b", 3_000), true, "keys are separate");
  assert.equal(l.retryAfterSeconds("a", 3_000), 57);
  assert.equal(l.tryAttempt("a", 60_001), true, "the first attempt has aged out");
});

test("0 disables it", () => {
  const l = createAttemptLimiter({ max: 0, windowMs: 60_000 });
  for (let i = 0; i < 100; i++) assert.equal(l.tryAttempt("a", i), true);
});

test("memory stays bounded", () => {
  const l = createAttemptLimiter({ max: 5, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 1_000; i++) l.tryAttempt(`k${i}`, i);
  // The newest keys are still counted; the oldest were dropped.
  for (let i = 0; i < 4; i++) l.tryAttempt("k999", 1_000 + i);
  assert.equal(l.tryAttempt("k999", 2_000), false);
});
