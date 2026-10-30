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

test("with nothing saved: Orchid, follow the system, sidebar, comfortable", () => {
  reset();
  assert.deepEqual(readAppearance(), DEFAULT_APPEARANCE);
  assert.deepEqual(DEFAULT_APPEARANCE, { design: "orchid", mode: "system", layout: "sidebar", density: "comfortable" });
  assert.deepEqual(
    DESIGNS.map((d) => d.id),
    ["orchid", "lagoon", "saffron"],
  );
});

test("a design saved under its old name carries over to its new one", () => {
  for (const [old, now] of [
    ["carnival", "orchid"],
    ["slate", "lagoon"],
    ["blush", "saffron"],
  ]) {
    reset();
    store.set("fp-appearance", JSON.stringify({ design: old, mode: "dark" }));
    assert.equal(readAppearance().design, now);
    assert.equal(readAppearance().mode, "dark");
  }
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
  assert.deepEqual(readAppearance(), { design: "orchid", mode: "system", layout: "topbar", density: "comfortable" });
  store.set("fp-appearance", "{not json");
  assert.deepEqual(readAppearance(), DEFAULT_APPEARANCE);
});

test("applying sets the data attributes the CSS keys on, and removes them again", () => {
  reset();
  applyAppearance({ design: "lagoon", mode: "dark", layout: "topbar", density: "compact" });
  assert.deepEqual({ ...attrs }, { design: "lagoon", theme: "night", layout: "topbar", density: "compact" });
  applyAppearance({ design: "saffron", mode: "light", layout: "sidebar", density: "comfortable" });
  assert.deepEqual({ ...attrs }, { design: "saffron" });
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
