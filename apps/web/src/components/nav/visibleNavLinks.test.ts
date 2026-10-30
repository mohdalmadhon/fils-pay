import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleNavLinks } from "./SidebarNav.js";

const ids = (links: { id: string }[]) => links.map((l) => l.id);

test("every link shows, in the default order, before the role is known", () => {
  assert.deepEqual(ids(visibleNavLinks(undefined, null)), [
    "overview",
    "transactions",
    "payment-links",
    "settlement",
    "reconciliation",
    "webhooks",
    "settings",
  ]);
});

test("support never sees reconciliation or webhooks, whatever the saved order says", () => {
  assert.deepEqual(ids(visibleNavLinks("support", ["webhooks", "reconciliation", "settings"])), [
    "settings",
    "overview",
    "transactions",
    "payment-links",
    "settlement",
  ]);
});

test("owner and finance get the saved order", () => {
  assert.deepEqual(ids(visibleNavLinks("finance", ["webhooks", "overview"])).slice(0, 3), ["webhooks", "overview", "transactions"]);
});
