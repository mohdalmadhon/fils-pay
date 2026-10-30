import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Every design (Carnival, Blush, Slate) in both modes defines the full set
 * of colour tokens, and every pair of text and background the components
 * use reaches WCAG AA (4.5:1). Read straight from theme.css, so a token
 * edit that breaks contrast fails here before anyone sees it.
 *
 * The Ops console keeps an identical copy of theme.css; that is checked
 * too.
 */

const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../../admin/src/theme.css", import.meta.url), "utf8");

const DESIGNS = ["carnival", "blush", "slate"] as const;
const MODES = ["light", "dark"] as const;

/** The custom properties set by the rule whose selector is exactly `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `theme.css has no rule for ${selector}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  return tokens;
}

function tokensFor(design: string, mode: string): Record<string, string> {
  const light = block(`:root[data-design="${design}"]`);
  if (mode === "light") return light;
  return { ...light, ...block(`:root[data-design="${design}"][data-theme="night"]`) };
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const REQUIRED = [
  "--c-bg",
  "--c-surface",
  "--c-surface-2",
  "--c-surface-3",
  "--c-line",
  "--c-line-2",
  "--c-ink",
  "--c-ink-2",
  "--c-ink-3",
  "--c-ink-4",
  "--c-primary",
  "--c-primary-hover",
  "--c-on-primary",
  "--c-accent",
  "--c-accent-ink",
  "--c-accent-soft",
  "--c-good",
  "--c-good-soft",
  "--c-warn",
  "--c-warn-soft",
  "--c-danger",
  "--c-danger-soft",
  "--c-neutral-soft",
  "--font-display",
];

/** [text token, background token]: the pairs components actually draw. */
const PAIRS: Array<[string, string]> = [
  ...["--c-ink", "--c-ink-2", "--c-ink-3"].flatMap((ink) =>
    ["--c-bg", "--c-surface", "--c-surface-2", "--c-surface-3"].map((bg): [string, string] => [ink, bg]),
  ),
  ["--c-on-primary", "--c-primary"],
  ["--c-on-primary", "--c-primary-hover"],
  ["--c-accent-ink", "--c-surface"],
  ["--c-accent-ink", "--c-accent-soft"],
  ["--c-good", "--c-good-soft"],
  ["--c-warn", "--c-warn-soft"],
  ["--c-danger", "--c-danger-soft"],
  ["--c-good", "--c-surface"],
  ["--c-warn", "--c-surface"],
  ["--c-danger", "--c-surface"],
  ["--c-ink-2", "--c-neutral-soft"],
];

for (const design of DESIGNS) {
  for (const mode of MODES) {
    test(`${design} ${mode}: every token is set and every text colour reaches 4.5:1`, () => {
      const t = tokensFor(design, mode);
      for (const name of REQUIRED) assert.ok(t[name], `${design} ${mode} is missing ${name}`);
      const failures = PAIRS.filter(([fg, bg]) => contrast(t[fg]!, t[bg]!) < 4.5).map(
        ([fg, bg]) => `${fg} ${t[fg]} on ${bg} ${t[bg]}: ${contrast(t[fg]!, t[bg]!).toFixed(2)}`,
      );
      assert.deepEqual(failures, []);
    });
  }
}

test("dark modes are coloured, not near-black: the page background is lighter than #121212", () => {
  for (const design of DESIGNS) {
    const bg = tokensFor(design, "dark")["--c-bg"]!;
    assert.ok(luminance(bg) > luminance("#121212") * 1.4, `${design} dark --c-bg ${bg} is too dark`);
  }
});

test("the Ops console's theme.css is the same file", () => {
  assert.equal(adminCss, css);
});
