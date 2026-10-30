#!/usr/bin/env node
/**
 * How the assistant checked the Settings > Appearance page works like a
 * person uses it: sign in, open Settings from the navigation, click each
 * kind of choice, move between designs with the arrow keys, reload, and
 * read back the data attributes on <html> that the CSS keys on. Run from
 * the repo root with the API (OTP_DEV_EXPOSE=true) and the dashboard dev
 * server running.
 *
 *   node ai-setup/scripts/settings-check.mjs
 *
 * Prints what each click set and whether it survived the reload, and exits
 * non-zero if any of it didn't happen. Env: WEB_URL.
 */
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");
const WEB = process.env.WEB_URL ?? "http://localhost:5173";

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${WEB}/dashboard/login`);
await page.getByLabel("Merchant ID").fill("9972daab-2c86-459f-9d78-3fe1be4e3280");
await page.getByLabel("Email").fill("owner@alpharetail.example");
await page.getByLabel("Password").fill("FilsPaySeed!2026");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Use it" }).click();
await page.getByRole("button", { name: /Verify/ }).click();
await page.waitForURL(/transactions/);

// Reach Settings from the navigation, as a person would.
await page.getByRole("link", { name: "Settings" }).click();
await page.waitForURL(/settings/);
const attrs = () => page.evaluate(() => ({ ...document.documentElement.dataset }));

// The radios are visually hidden; a person clicks the cards and labels.
const got = {};
await page.locator("label.fp-settings-card", { hasText: "Lagoon" }).click();
got.design = (await attrs()).design;
await page.locator(".fp-settings-segment label", { hasText: /^Dark$/ }).click();
got.theme = (await attrs()).theme;
await page.locator("label.fp-settings-card", { hasText: "Top bar" }).click();
got.layout = (await attrs()).layout;
await page.locator("label.fp-settings-option", { hasText: "Compact" }).click();
got.density = (await attrs()).density;
await page.locator("label.fp-settings-option", { hasText: "Halloween costume" }).click();
await page.waitForTimeout(800);
got.costume = (await attrs()).costume;
// Keyboard: from Lagoon, the left arrow moves to Cobalt.
await page.getByRole("radio", { name: /Lagoon/ }).focus();
await page.keyboard.press("ArrowLeft");
got.keyboard = (await attrs()).design;
await page.reload();
await page.waitForLoadState("networkidle");
got.afterReload = await attrs();

const expected = { design: "lagoon", theme: "night", layout: "topbar", density: "compact", costume: "halloween", keyboard: "cobalt" };
const wrong = Object.entries(expected).filter(([k, v]) => got[k] !== v);
const kept = got.afterReload.design === "cobalt" && got.afterReload.layout === "topbar" && got.afterReload.costume === "halloween";
console.log(JSON.stringify(got));
console.log(wrong.length === 0 && kept && errors.length === 0 ? "settings: every choice applied and survived a reload" : `settings: FAILED ${JSON.stringify({ wrong, kept, errors })}`);
await browser.close();
process.exit(wrong.length === 0 && kept && errors.length === 0 ? 0 : 1);
