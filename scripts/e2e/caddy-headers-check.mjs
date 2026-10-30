#!/usr/bin/env node
/**
 * The pages' security headers through the real Caddyfile (docs/defence/06):
 * builds are served by Caddy on :8080 (dashboard, checkout) and :8081 (Ops),
 * with the API on :3000. Signs in to both apps, opens every dashboard page,
 * the tour and a checkout, and reports any Content-Security-Policy violation,
 * whether a checkout can be framed by another page, and the headers.
 *
 * Setup (what docs/defence/06 ran):
 *   (cd apps/web && VITE_API_BASE_URL="" npx vite build --outDir /tmp/csp/web)
 *   (cd apps/admin && VITE_ADMIN_API_BASE_URL="" npx vite build --outDir /tmp/csp/admin)
 *   sed -e 's#api:3000#localhost:3000#' -e 's#/srv/#/tmp/csp/#' ops/Caddyfile > /tmp/csp/Caddyfile
 *   SITE_ADDRESS=http://localhost:8080 OPS_ADDRESS=http://localhost:8081 caddy run --config /tmp/csp/Caddyfile
 *   API with OTP_DEV_EXPOSE=true on :3000, seeded database
 *   node scripts/e2e/caddy-headers-check.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const violations = [];
const errors = [];
page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push(t.slice(0, 200)); });
page.on("pageerror", (e) => errors.push(e.message));
const res = await page.goto("http://localhost:8080/dashboard/login");
const h = res.headers();
console.log("headers", JSON.stringify({ csp: !!h["content-security-policy"], xfo: h["x-frame-options"], hsts: !!h["strict-transport-security"], pp: !!h["permissions-policy"] }));
await page.getByLabel("Merchant ID").fill("9972daab-2c86-459f-9d78-3fe1be4e3280");
await page.getByLabel("Email").fill("owner@alpharetail.example");
await page.getByLabel("Password").fill("FilsPaySeed!2026");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Use it" }).click();
await page.getByRole("button", { name: /Verify/ }).click();
await page.waitForURL(/transactions/);
for (const p of ["overview", "transactions", "payment-links", "settlement", "webhooks", "settings"]) {
  await page.goto(`http://localhost:8080/dashboard/${p}`); await page.waitForLoadState("networkidle");
}
// fonts loaded?
const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
// tour + edit layout still work
await page.getByRole("button", { name: /Take a tour/ }).click();
const tourOk = await page.getByRole("dialog").waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
await page.keyboard.press("Escape");
// checkout page: create a link via API
const url = await page.evaluate(async () => {
  const r = await fetch("/v1/merchants/9972daab-2c86-459f-9d78-3fe1be4e3280/payment-links", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountFils: 1500, expiresAt: new Date(Date.now() + 3.6e6).toISOString() }) });
  return (await r.json()).url;
});
const token = url.split("/pay/")[1];
const buyer = await ctx.newPage();
buyer.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push("checkout: " + t.slice(0, 200)); });
await buyer.goto(`http://localhost:8080/pay/${token}`); await buyer.waitForLoadState("networkidle");
const checkoutText = (await buyer.textContent("body")).slice(0, 80);
// framing check: another origin tries to frame the checkout
const framer = await ctx.newPage();
await framer.setContent(`<iframe id=f src="http://localhost:8080/pay/${token}" width=400 height=300></iframe>`);
await framer.waitForTimeout(1500);
const framed = await framer.frames().find((f) => f.url().includes("/pay/"))?.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => -1);
// admin
const admin = await ctx.newPage();
admin.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push("admin: " + t.slice(0, 200)); });
await admin.goto("http://localhost:8081/"); await admin.waitForLoadState("networkidle");
await admin.getByLabel("Email").fill("superadmin@filspay.test");
await admin.getByLabel("Password").fill("FilsPayAdminSeed!2026");
await admin.getByRole("button", { name: /Continue|Sign in/ }).click();
await admin.getByRole("button", { name: "Use it" }).click().catch(() => {});
await admin.getByRole("button", { name: /Verify/ }).click().catch(() => {});
await admin.waitForTimeout(1500);
const adminText = (await admin.textContent("body")).slice(0, 120);
console.log("admin:", adminText.replace(/\s+/g, " "));
console.log(JSON.stringify({ violations, errors, fonts: [...new Set(fonts)], tourOk, checkoutText, framedContentLength: framed ?? "blocked" }, null, 1));
await b.close();
