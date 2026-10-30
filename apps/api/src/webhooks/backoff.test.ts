/** backoffDelayMs: exponential, capped, ±10 % jitter. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelayMs } from "./dispatcher.js";

const config = { webhookBackoffBaseMs: 30_000, webhookBackoffCapMs: 21_600_000 };

test("doubles per attempt with jitter at its midpoint", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffDelayMs(n, config, () => 0.5)), [30_000, 60_000, 120_000, 240_000]);
});

test("jitter stays within ±10 %", () => {
  assert.equal(backoffDelayMs(1, config, () => 0), 27_000);
  assert.equal(backoffDelayMs(1, config, () => 0.999999), 33_000);
  for (let i = 0; i < 200; i += 1) {
    const d = backoffDelayMs(3, config);
    assert.ok(d >= 108_000 && d <= 132_000, String(d));
  }
});

test("is capped at webhookBackoffCapMs (before jitter)", () => {
  assert.equal(backoffDelayMs(30, config, () => 0.5), 21_600_000);
});
