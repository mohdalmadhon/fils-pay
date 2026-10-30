#!/usr/bin/env node
/**
 * Browser check for "Take a tour" (docs/design/take-a-tour.md): a merchant
 * signs in, the tour button says New, the tour walks every step with Next
 * and Back (outlining the right element, focus inside the card), Escape
 * skips it, Finish ends it, the New mark goes away and stays away after a
 * reload, and it also runs in the top-bar layout and on a phone-sized
 * screen.
 *
 * Usage (from the repo root, with the API started with OTP_DEV_EXPOSE=true
 * and the dashboard running):
 *   WEB_URL=http://localhost:5173 node scripts/e2e/tour-check.mjs
 *
 * Optional: MERCHANT_ID, MERCHANT_EMAIL, MERCHANT_PASSWORD (default: the
 * seed's Alpha Retail owner), SHOTS=<dir> for screenshots.
 * Exit code 0 when every check passed, 1 otherwise.
 */
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");
const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
};
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

await page.goto(`${WEB}/dashboard/login`);
await page.getByLabel("Merchant ID").fill(process.env.MERCHANT_ID ?? "9972daab-2c86-459f-9d78-3fe1be4e3280");
await page.getByLabel("Email").fill(process.env.MERCHANT_EMAIL ?? "owner@alpharetail.example");
await page.getByLabel("Password").fill(process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Use it" }).click();
await page.getByRole("button", { name: /Verify/ }).click();
await page.waitForURL(/transactions/);
await page.evaluate(() => {
  localStorage.removeItem("fp-tour-seen");
  localStorage.removeItem("fp-appearance");
});
await page.reload();
await page.waitForLoadState("networkidle");

const tourButton = page.getByRole("button", { name: /Take a tour/ });
check("the tour button is marked New", /New/.test((await tourButton.textContent()) ?? ""));

const dialog = page.getByRole("dialog");
const title = () => page.locator("#fp-tour-title").textContent();
const progress = () => page.locator(".fp-tour-progress").textContent();
const spotCovers = async (selector) => {
  const spot = await page.locator(".fp-tour-spot").boundingBox();
  const target = await page.locator(selector).boundingBox();
  if (!spot || !target) return false;
  return spot.x <= target.x && spot.y <= target.y && spot.x + spot.width >= target.x + target.width - 1 && spot.y + spot.height >= target.y + target.height - 1;
};

// Escape skips.
await tourButton.click();
await dialog.waitFor();
check("Escape skips the tour", (await page.keyboard.press("Escape"), await dialog.count()) === 0);
check("focus goes back to the tour button", await tourButton.evaluate((el) => el === document.activeElement));

// Walk it.
await page.evaluate(() => localStorage.removeItem("fp-tour-seen"));
await tourButton.click();
await dialog.waitFor();
check("step 1 is the welcome, centred", (await progress())?.startsWith("Step 1 of 7") && (await dialog.getAttribute("data-side")) === "center");
check("focus is on Next", await page.getByRole("button", { name: "Next" }).evaluate((el) => el === document.activeElement));
await shot("tour-1-welcome");
const seen = [];
const expected = [
  ["Your pages", '[data-tour="nav"]'],
  ["Search or jump anywhere", '[data-tour="search"]'],
  ["Where the work happens", '[data-tour="main"]'],
  ["Put the links in your order", '[data-tour="edit-layout"]'],
  ["Light or dark", '[data-tour="theme"]'],
  ["That's it", '[data-tour="tour"]'],
];
for (const [i, [name, selector]] of expected.entries()) {
  await page.getByRole("button", { name: i === expected.length ? "Finish" : "Next" }).click();
  await page.waitForTimeout(350);
  const t = await title();
  seen.push(t);
  check(`step ${i + 2} "${name}" outlines its element`, t === name && (await spotCovers(selector)), String(t));
  if (i === 0) await shot("tour-2-nav");
  if (i === 2) await shot("tour-4-main");
}
await page.getByRole("button", { name: "Back" }).click();
check("Back goes to the previous step", (await title()) === "Light or dark");
await page.getByRole("button", { name: "Next" }).click();
await shot("tour-7-end");
await page.getByRole("button", { name: "Finish" }).click();
check("Finish closes the tour", (await dialog.count()) === 0);
check("the New mark is gone", !/New/.test((await tourButton.textContent()) ?? ""));
await page.reload();
await page.waitForLoadState("networkidle");
check("and stays gone after a reload", !/New/.test((await page.getByRole("button", { name: /Take a tour/ }).textContent()) ?? ""));

// From the search palette.
await page.locator(".fp-nav-search").click();
await page.keyboard.type("tour");
await page.keyboard.press("Enter");
check("the palette's Take a tour starts it", await dialog.waitFor({ timeout: 3000 }).then(() => true).catch(() => false));
await page.getByRole("button", { name: "Skip tour" }).click();

// Top-bar layout.
await page.evaluate(() =>
  localStorage.setItem("fp-appearance", JSON.stringify({ design: "cobalt", mode: "night", layout: "topbar", density: "comfortable" })),
);
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /Take a tour/ }).click();
await dialog.waitFor();
await page.getByRole("button", { name: "Next" }).click();
await page.waitForTimeout(350);
check("top-bar layout: the nav step outlines the bar's links", await spotCovers('[data-tour="nav"]'));
await shot("tour-topbar-dark");
await page.keyboard.press("Escape");
await page.evaluate(() => localStorage.removeItem("fp-appearance"));

// Phone.
await page.setViewportSize({ width: 390, height: 800 });
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByRole("button", { name: /Take a tour/ }).click();
await dialog.waitFor();
check("phone: 6 steps (the main area is left out)", (await progress())?.endsWith("of 6"), String(await progress()));
await page.getByRole("button", { name: "Next" }).click();
await page.waitForTimeout(350);
const card = await page.locator(".fp-tour-card").boundingBox();
check("phone: the card stays inside the screen", !!card && card.x >= 0 && card.x + card.width <= 390 && card.y >= 0 && card.y + card.height <= 800);
await shot("tour-phone-nav");
await page.getByRole("button", { name: "Skip tour" }).click();

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
