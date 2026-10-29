/** Pure tests for the webhook destination guard. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { guardedLookup, isBlockedAddress, isObviouslyLocalHost } from "./destination.js";

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("non-IP input is treated as blocked", () => {
  assert.equal(isBlockedAddress("not-an-ip"), true);
});

test("obviously local hosts are caught at save time", () => {
  for (const h of ["localhost", "api.localhost", "printer.local", "metadata.google.internal", "intranet", "127.0.0.1", "[::1]", "169.254.169.254"]) {
    assert.equal(isObviouslyLocalHost(h), true, h);
  }
  for (const h of ["hooks.example.com", "8.8.8.8", "shop.example.bh"]) {
    assert.equal(isObviouslyLocalHost(h), false, h);
  }
});

test("guardedLookup refuses a name that resolves to loopback", async () => {
  const err = await new Promise<Error | null>((resolve) => guardedLookup("localhost", {}, (e) => resolve(e)));
  assert.ok(err);
  assert.match(err!.message, /not allowed/);
});
