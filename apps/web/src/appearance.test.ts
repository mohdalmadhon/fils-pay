import assert from "node:assert/strict";
import test from "node:test";

/**
 * The saved appearance (components/kit/theme.ts): defaults, carrying over
 * the old light/night setting, ignoring anything unknown, and the data
 * attributes it puts on <html>. Runs with a small stand-in for the
 * browser's window and document.
 */

const store = new Map<string, string>();
let prefersDark = false;
const attrs: Record<string, string> = {};

const root = {
  dataset: new Proxy(attrs, {
    deleteProperty(target, key) {
      delete target[key as string];
      return true;
    },
  }),
  classList: { add() {}, remove() {} },
};

Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    matchMedia: () => ({ matches: prefersDark, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout,
  },
  document: { documentElement: root, querySelector: () => null },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
});

const { readAppearance, applyAppearance, DEFAULT_APPEARANCE, DESIGNS } = await import("./components/kit/theme.js");

function reset(): void {
  store.clear();
  prefersDark = false;
  for (const k of Object.keys(attrs)) delete attrs[k];
}

test("with nothing saved: Carnival, follow the system, sidebar, comfortable", () => {
  reset();
  assert.deepEqual(readAppearance(), DEFAULT_APPEARANCE);
  assert.deepEqual(DEFAULT_APPEARANCE, { design: "carnival", mode: "system", layout: "sidebar", density: "comfortable" });
  assert.deepEqual(
    DESIGNS.map((d) => d.id),
    ["carnival", "blush", "slate"],
  );
});

test("an old light/night choice is carried over", () => {
  reset();
  store.set("fp-theme", "night");
  assert.equal(readAppearance().mode, "dark");
  reset();
  store.set("fp-theme", "light");
  assert.equal(readAppearance().mode, "light");
});

test("unknown or broken saved values fall back to the defaults, one field at a time", () => {
  reset();
  store.set("fp-appearance", JSON.stringify({ design: "neon", mode: "dusk", layout: "topbar", density: "tiny" }));
  assert.deepEqual(readAppearance(), { design: "carnival", mode: "system", layout: "topbar", density: "comfortable" });
  store.set("fp-appearance", "{not json");
  assert.deepEqual(readAppearance(), DEFAULT_APPEARANCE);
});

test("applying sets the data attributes the CSS keys on, and removes them again", () => {
  reset();
  applyAppearance({ design: "slate", mode: "dark", layout: "topbar", density: "compact" });
  assert.deepEqual({ ...attrs }, { design: "slate", theme: "night", layout: "topbar", density: "compact" });
  applyAppearance({ design: "blush", mode: "light", layout: "sidebar", density: "comfortable" });
  assert.deepEqual({ ...attrs }, { design: "blush" });
});

test("'system' follows the operating system's dark setting", () => {
  reset();
  prefersDark = true;
  applyAppearance({ ...DEFAULT_APPEARANCE, mode: "system" });
  assert.equal(attrs.theme, "night");
  prefersDark = false;
  applyAppearance({ ...DEFAULT_APPEARANCE, mode: "system" });
  assert.equal(attrs.theme, undefined);
});
