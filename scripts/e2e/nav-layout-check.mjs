#!/usr/bin/env node
/**
 * Browser check for "Edit layout" (docs/design/edit-layout.md): a merchant
 * signs in, opens Edit layout, moves a link with the arrow buttons and
 * another by dragging, and the new order shows in the sidebar, survives a
 * reload, and goes back to the default with Reset. Also opens the editor in
 * the top-bar layout and on a phone-sized screen.
 *
 * Usage (from the repo root, with the API started with OTP_DEV_EXPOSE=true
 * and the dashboard running):
 *   WEB_URL=http://localhost:5173 node scripts/e2e/nav-layout-check.mjs
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
await page.evaluate(() => localStorage.removeItem("fp-nav-order"));
await page.reload();
await page.waitForLoadState("networkidle");

const navOrder = () => page.locator("nav.dash-nav a").allTextContents();
const DEFAULT = ["Overview", "Transactions", "Payment links", "Settlement", "Reconciliation", "Webhooks", "Settings"];
check("the sidebar starts in the default order", JSON.stringify(await navOrder()) === JSON.stringify(DEFAULT), String(await navOrder()));

await page.getByRole("button", { name: "Edit layout" }).click();
for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Move Settings up" }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(150);
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check("focus stays on the moved row", focused === "Move Settings down", String(focused));
const rows = page.locator(".dash-nav-editor-row");
await rows.filter({ hasText: "Overview" }).dragTo(rows.last());
const live = await page.locator(".dash-nav-editor [aria-live]").textContent();
check("the move is announced", /Overview moved to position 7 of 7/.test(live ?? ""), String(live));
await shot("edit-layout-editing");
await page.getByRole("button", { name: "Done", exact: true }).click();

const EXPECTED = ["Settings", "Transactions", "Payment links", "Settlement", "Reconciliation", "Webhooks", "Overview"];
check("the sidebar shows the new order", JSON.stringify(await navOrder()) === JSON.stringify(EXPECTED), String(await navOrder()));
check("a custom order hides the section headings", (await page.locator(".dash-nav-label").count()) === 0);
await page.reload();
await page.waitForLoadState("networkidle");
check("the order survives a reload", JSON.stringify(await navOrder()) === JSON.stringify(EXPECTED), String(await navOrder()));

await page.getByRole("button", { name: "Edit layout" }).click();
await page.getByRole("button", { name: "Reset to the default order" }).click();
await page.getByRole("button", { name: "Done", exact: true }).click();
check("Reset brings back the default order", JSON.stringify(await navOrder()) === JSON.stringify(DEFAULT), String(await navOrder()));
check("and the section headings", (await page.locator(".dash-nav-label").count()) > 0);

await page.evaluate(() =>
  localStorage.setItem("fp-appearance", JSON.stringify({ design: "cobalt", mode: "light", layout: "topbar", density: "comfortable" })),
);
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: "Edit layout" }).click();
check("the editor opens in the top-bar layout", await page.locator(".dash-nav-editor").isVisible());
await shot("edit-layout-topbar");
await page.evaluate(() => localStorage.removeItem("fp-appearance"));

await page.setViewportSize({ width: 390, height: 800 });
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByRole("button", { name: "Edit layout" }).click();
check("the editor opens in the phone drawer", await page.locator(".dash-nav-editor").isVisible());
await shot("edit-layout-phone");

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
