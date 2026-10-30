import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_NAV_ORDER,
  NAV_ORDER_KEY,
  applyNavOrder,
  isDefaultNavOrder,
  loadNavOrder,
  moveNavItem,
  moveNavItemTo,
  saveNavOrder,
} from "./navOrder.js";

const ALL = [...DEFAULT_NAV_ORDER];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test("no saved order keeps the default", () => {
  assert.deepEqual(applyNavOrder(ALL, null), ALL);
  assert.deepEqual(applyNavOrder(ALL, []), ALL);
});

test("a saved order rearranges, and links it doesn't know follow in default order", () => {
  assert.deepEqual(applyNavOrder(ALL, ["settings", "webhooks"]), [
    "settings",
    "webhooks",
    "overview",
    "transactions",
    "payment-links",
    "settlement",
    "reconciliation",
  ]);
});

test("a saved order can't show a link the person may not see, and ignores junk", () => {
  const support = ALL.filter((id) => id !== "reconciliation" && id !== "webhooks");
  assert.deepEqual(applyNavOrder(support, ["webhooks", "bogus", "settings", "settings", "overview"]), [
    "settings",
    "overview",
    "transactions",
    "payment-links",
    "settlement",
  ]);
});

test("moving up and down stops at the ends", () => {
  assert.deepEqual(moveNavItem(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveNavItem(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveNavItem(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveNavItem(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveNavItem(["a", "b", "c"], "x" as "a", 1), ["a", "b", "c"]);
});

test("drag and drop places an item at an index", () => {
  assert.deepEqual(moveNavItemTo(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveNavItemTo(["a", "b", "c", "d"], "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveNavItemTo(["a", "b", "c", "d"], "b", 99), ["a", "c", "d", "b"]);
});

test("the default order is recognised, also for a subset", () => {
  assert.equal(isDefaultNavOrder(ALL), true);
  assert.equal(isDefaultNavOrder(["overview", "settlement", "settings"]), true);
  assert.equal(isDefaultNavOrder(["settings", "overview"]), false);
});

test("saving and loading round-trips; the default order clears storage", () => {
  const storage = memoryStorage();
  saveNavOrder(["settings", "overview"], storage);
  assert.equal(storage.data.get(NAV_ORDER_KEY), JSON.stringify(["settings", "overview"]));
  assert.deepEqual(loadNavOrder(storage), ["settings", "overview"]);
  saveNavOrder(ALL, storage);
  assert.equal(storage.data.has(NAV_ORDER_KEY), false);
  assert.equal(loadNavOrder(storage), null);
});

test("broken or throwing storage means the default order", () => {
  assert.equal(loadNavOrder(memoryStorage({ [NAV_ORDER_KEY]: "{not json" })), null);
  assert.equal(loadNavOrder(memoryStorage({ [NAV_ORDER_KEY]: JSON.stringify({ a: 1 }) })), null);
  assert.deepEqual(loadNavOrder(memoryStorage({ [NAV_ORDER_KEY]: JSON.stringify(["x", "webhooks"]) })), ["webhooks"]);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadNavOrder(throwing), null);
  assert.doesNotThrow(() => saveNavOrder(["settings"], throwing));
});
