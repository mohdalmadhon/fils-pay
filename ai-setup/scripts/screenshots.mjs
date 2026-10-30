#!/usr/bin/env node
/**
 * How the assistant checked every design change by eye: sign in to the
 * dashboard as the seed's Alpha Retail owner, pick an appearance, and
 * screenshot pages at 1280x800. Run from the repo root with the API (with
 * OTP_DEV_EXPOSE=true) and the dashboard dev server running.
 *
 *   node ai-setup/scripts/screenshots.mjs <design> <light|dark> <out-prefix> [pages]
 *   node ai-setup/scripts/screenshots.mjs cobalt dark /tmp/shot overview,transactions,login,checkout
 *
 * Env: WEB_URL, API_URL, LAYOUT (sidebar|topbar), DENSITY
 * (comfortable|compact), COSTUME (off|halloween). Prints any page errors.
 */
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:3000";
const MERCHANT_ID = "9972daab-2c86-459f-9d78-3fe1be4e3280";
const [design, mode, out, pages = "overview,transactions"] = process.argv.slice(2);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(
  ([d, m, l, dn, c]) => {
    localStorage.setItem("fp-appearance", JSON.stringify({ design: d, mode: m, layout: l, density: dn }));
    localStorage.setItem("fp-costume", c);
  },
  [design, mode, process.env.LAYOUT ?? "sidebar", process.env.DENSITY ?? "comfortable", process.env.COSTUME ?? "off"],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${WEB}/dashboard/login`);
await page.waitForTimeout(700);
if (pages.includes("login")) await page.screenshot({ path: `${out}-login.png` });
await page.getByLabel("Merchant ID").fill(MERCHANT_ID);
await page.getByLabel("Email").fill("owner@alpharetail.example");
await page.getByLabel("Password").fill("FilsPaySeed!2026");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Use it" }).click();
await page.getByRole("button", { name: /Verify/ }).click();
await page.waitForURL(/transactions/);

for (const name of pages.split(",").filter((x) => x !== "login" && x !== "checkout")) {
  await page.goto(`${WEB}/dashboard/${name}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-${name.replace(/\//g, "_")}.png` });
}

if (pages.includes("checkout")) {
  const url = await page.evaluate(
    async ([api, id]) => {
      const res = await fetch(`${api}/v1/merchants/${id}/payment-links`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountFils: 148_500, description: "Order 1042", expiresAt: new Date(Date.now() + 3.6e6).toISOString() }),
      });
      return (await res.json()).url;
    },
    [API, MERCHANT_ID],
  );
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-checkout.png` });
}

console.log(design, mode, "page errors:", errors.length ? errors : "none");
await browser.close();
