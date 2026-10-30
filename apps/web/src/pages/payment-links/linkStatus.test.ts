import assert from "node:assert/strict";
import test from "node:test";
import { canCancelLink, displayedLinkStatus } from "./linkStatus.js";

const now = new Date("2026-10-30T12:00:00.000Z");

test("an active link past its expiry shows as Expired and can't be cancelled", () => {
  const link = { status: "active" as const, expiresAt: "2026-10-30T11:59:59.000Z" };
  assert.equal(displayedLinkStatus(link, now), "expired");
  assert.equal(canCancelLink(link, now), false);
  // Exactly at expiry counts as expired too.
  assert.equal(displayedLinkStatus({ status: "active", expiresAt: now.toISOString() }, now), "expired");
});

test("an active link before its expiry stays Active and can be cancelled", () => {
  const link = { status: "active" as const, expiresAt: "2026-10-30T12:00:01.000Z" };
  assert.equal(displayedLinkStatus(link, now), "active");
  assert.equal(canCancelLink(link, now), true);
});

test("other stored statuses are shown as they are", () => {
  for (const status of ["reserved", "paid", "canceled"] as const) {
    assert.equal(displayedLinkStatus({ status, expiresAt: "2026-01-01T00:00:00.000Z" }, now), status);
  }
});
