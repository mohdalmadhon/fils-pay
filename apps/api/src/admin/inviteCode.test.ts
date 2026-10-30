/**
 * Admin invite codes are bearer credentials (redeeming one creates an admin
 * with the invite's role), so they must come from crypto, not Math.random(),
 * and be long enough not to be guessed. Before the fix: Math.random(), 8
 * characters (40 bits). Pure.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateInviteCode } from "./inviteCode.js";

test("invite codes don't depend on Math.random", () => {
  const original = Math.random;
  Math.random = () => 0;
  try {
    const a = generateInviteCode();
    const b = generateInviteCode();
    assert.notEqual(a, b, "a stubbed Math.random must not make codes repeat");
  } finally {
    Math.random = original;
  }
});

test("invite codes carry at least 80 bits", () => {
  const code = generateInviteCode();
  assert.ok(code.length * Math.log2(32) >= 80, `only ${code.length} characters`);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
});
