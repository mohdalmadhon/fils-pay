import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Every design (Cobalt, Lagoon, Saffron) in both modes defines the full set
 * of colour tokens, and every pair of text and background the components
 * use reaches WCAG AA (4.5:1). The thick ink borders that outline cards,
 * fields and buttons reach 3:1 against everything they sit on (WCAG's
 * contrast for the edges of controls). Read straight from theme.css, so a
 * token edit that breaks contrast fails here before anyone sees it.
 *
 * The Ops console keeps an identical copy of theme.css; that is checked
 * too.
 */

const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../../admin/src/theme.css", import.meta.url), "utf8");

const DESIGNS = ["cobalt", "lagoon", "saffron"] as const;
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
  "--side-bg",
  "--side-surface",
  "--side-surface-3",
  "--side-line",
  "--side-ink",
  "--side-ink-2",
  "--side-ink-3",
  "--side-active-bg",
  "--side-active-ink",
  "--hero-bg",
  "--hero-ink",
  "--hero-ink-2",
  "--hero-action-bg",
  "--hero-action-ink",
  "--c-action",
  "--c-on-action",
  "--c-border",
  "--c-shadow-hard",
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
  // The sidebar has its own colours, darker than the page.
  ...["--side-ink", "--side-ink-2", "--side-ink-3"].flatMap((ink) =>
    ["--side-bg", "--side-surface", "--side-surface-3"].map((bg): [string, string] => [ink, bg]),
  ),
  ["--side-active-ink", "--side-active-bg"],
  // The balance band on Overview.
  ["--hero-ink", "--hero-bg"],
  ["--hero-ink-2", "--hero-bg"],
  ["--hero-action-ink", "--hero-action-bg"],
  // Primary buttons: a flat fill in the design's loudest colour.
  ["--c-on-action", "--c-action"],
  // Links and the selected tab are drawn in the primary colour.
  ["--c-primary", "--c-surface"],
  ["--c-primary", "--c-bg"],
];

/** [edge colour, what it sits on]: borders that must be seen, 3:1. */
const EDGES: Array<[string, string]> = [
  ...["--c-bg", "--c-surface", "--c-surface-2", "--c-surface-3", "--c-input"].map((bg): [string, string] => ["--c-border", bg]),
  ["--side-ink", "--side-bg"],
];

for (const design of DESIGNS) {
  for (const mode of MODES) {
    test(`${design} ${mode}: every token is set and every text colour reaches 4.5:1 and every border 3:1`, () => {
      const t = tokensFor(design, mode);
      for (const name of REQUIRED) assert.ok(t[name], `${design} ${mode} is missing ${name}`);
      const failures = PAIRS.filter(([fg, bg]) => contrast(t[fg]!, t[bg]!) < 4.5).map(
        ([fg, bg]) => `${fg} ${t[fg]} on ${bg} ${t[bg]}: ${contrast(t[fg]!, t[bg]!).toFixed(2)}`,
      );
      assert.deepEqual(failures, []);
      const edges = EDGES.filter(([fg, bg]) => contrast(t[fg]!, t[bg]!) < 3).map(
        ([fg, bg]) => `${fg} ${t[fg]} on ${bg} ${t[bg]}: ${contrast(t[fg]!, t[bg]!).toFixed(2)}`,
      );
      assert.deepEqual(edges, []);
    });
  }
}

test("dark modes are dark, but tinted with the design's colour rather than flat grey", () => {
  for (const design of DESIGNS) {
    const bg = tokensFor(design, "dark")["--c-bg"]!;
    assert.ok(luminance(bg) < 0.012, `${design} dark --c-bg ${bg} is not dark enough`);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(1 + i, 3 + i), 16));
    assert.ok(Math.max(r!, g!, b!) - Math.min(r!, g!, b!) >= 8, `${design} dark --c-bg ${bg} is flat grey`);
  }
});

test("the Ops console's theme.css is the same file", () => {
  assert.equal(adminCss, css);
});
