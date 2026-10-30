import assert from "node:assert/strict";
import test from "node:test";
import { openInNewTab } from "./openTab.js";

test("an opened tab counts as opened, and its opener link is cut", () => {
  const calls: unknown[][] = [];
  const tab = { opener: {} as unknown } as Window;
  const ok = openInNewTab("https://dash.example", (...args) => {
    calls.push(args);
    return tab;
  });
  assert.equal(ok, true);
  assert.equal(tab.opener, null);
  // No "noopener" feature string: with it, window.open always returns null.
  assert.deepEqual(calls, [["https://dash.example", "_blank"]]);
});

test("a blocked popup (null) is reported as blocked", () => {
  assert.equal(openInNewTab("https://dash.example", () => null), false);
});
