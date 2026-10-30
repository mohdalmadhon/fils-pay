#!/usr/bin/env node
/**
 * Browser end-to-end check: a merchant signs in to the dashboard, creates a
 * payment link, and a customer pays it on the checkout page, all in a real
 * browser (Playwright, Chromium). Write-up: docs/improvements/17.
 *
 * It covers what the API tests can't: the pages, the router, cookies
 * crossing origins (dashboard on :5173, API on :3000, CORS with
 * credentials), and the forms people actually use.
 *
 *   1. dashboard sign-in: password, then the one-time code (needs the API
 *      started with OTP_DEV_EXPOSE=true, local only, so the page shows it)
 *   2. create a payment link from the form; its detail page says Active
 *   3. a customer, in a separate browser context with no cookies, opens the
 *      link: amount and merchant shown; a declined card is reported and the
 *      form stays; an approved card ends on the receipt ("Paid to …")
 *   4. the merchant's link page now says Paid and links to the transaction,
 *      whose page opens
 *   5. no uncaught page errors or console errors anywhere
 *
 * Usage (from the repo root, with the API and the dashboard running):
 *   API_URL=http://localhost:3000 WEB_URL=http://localhost:5173 \
 *   node scripts/e2e/browser-check.mjs
 *
 * Optional: MERCHANT_ID, MERCHANT_EMAIL, MERCHANT_PASSWORD (default: the
 * seed's Alpha Retail owner), HEADED=1 to watch it, E2E_ARTIFACTS=<dir> for
 * a screenshot of every step (default: a screenshot only on failure, in
 * ./e2e-artifacts).
 *
 * Exit code 0 when every check passed, 1 otherwise. Creates a real link and
 * payment; run it against a dev or CI database.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const API = process.env.API_URL ?? "http://localhost:3000";
const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const MERCHANT_ID = process.env.MERCHANT_ID ?? "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = process.env.MERCHANT_EMAIL ?? "owner@alpharetail.example";
const PASSWORD = process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026";
const ARTIFACTS = process.env.E2E_ARTIFACTS ?? "e2e-artifacts";
const EVERY_STEP = Boolean(process.env.E2E_ARTIFACTS);
const AMOUNT_FILS = 12_345; // 12.345 BHD: three decimals, so a cents/fils mix-up shows
const REFERENCE = `browser-${randomUUID().slice(0, 8)}`;
const TIMEOUT = 15_000;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return ok;
}

/**
 * Collects anything the pages throw or log as an error. Chromium's own
 * "Failed to load resource" lines are left out: the pages handle failed API
 * calls themselves (the session probe before sign-in is a 401, a declined
 * card is a 402), and the checks above judge what the page then shows. Web
 * fonts that can't be fetched (an offline CI box) fall back without harm.
 */
function watch(page, label, problems) {
  page.on("pageerror", (err) => problems.push(`${label}: page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      problems.push(`${label}: console error: ${msg.text()}`);
    }
  });
}

async function shot(page, name, always = false) {
  if (!always && !EVERY_STEP) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: true });
}

async function main() {
  // Fail fast with a clear message if a server isn't up.
  for (const [name, url] of [["API", `${API}/v1/payment-links/not-a-token`], ["dashboard", `${WEB}/dashboard/login`]]) {
    try {
      await fetch(url);
    } catch {
      console.error(`browser-check: can't reach the ${name} at ${url}. Start it first (see the usage note).`);
      process.exit(1);
    }
  }

  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const problems = [];
  const merchant = await browser.newContext();
  const customer = await browser.newContext();
  const dash = await merchant.newPage();
  const pay = await customer.newPage();
  dash.setDefaultTimeout(TIMEOUT);
  pay.setDefaultTimeout(TIMEOUT);
  watch(dash, "dashboard", problems);
  watch(pay, "checkout", problems);
  let current = dash;

  try {
    // 1. Sign in.
    await dash.goto(`${WEB}/dashboard/login`);
    await dash.getByLabel("Merchant ID").fill(MERCHANT_ID);
    await dash.getByLabel("Email").fill(EMAIL);
    await dash.getByLabel("Password").fill(PASSWORD);
    await dash.getByRole("button", { name: "Continue" }).click();
    await dash.getByRole("heading", { name: "Enter your code" }).waitFor();
    const devCode = dash.getByRole("button", { name: "Use it" });
    if (!check("sign-in asks for a one-time code, shown in dev", await devCode.isVisible(), "start the API with OTP_DEV_EXPOSE=true")) {
      throw new Error("no development code on the page");
    }
    await devCode.click();
    await dash.getByRole("button", { name: "Verify and sign in" }).click();
    await dash.waitForURL(/\/dashboard\/transactions/);
    check("signed in lands on the transactions page", true, dash.url());
    await shot(dash, "1-signed-in");

    // 2. Create a payment link.
    await dash.goto(`${WEB}/dashboard/payment-links/new`);
    await dash.getByLabel("Amount in fils").fill(String(AMOUNT_FILS));
    await dash.getByLabel("Reference (optional)").fill(REFERENCE);
    await dash.getByLabel("Description (optional)").fill("Browser check");
    // datetime-local wants local time, no zone: tomorrow at this hour.
    const t = new Date(Date.now() + 24 * 3_600_000);
    const pad = (n) => String(n).padStart(2, "0");
    await dash
      .getByLabel("Expires at")
      .fill(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`);
    await dash.getByRole("button", { name: "Create payment link" }).click();
    await dash.waitForURL(/\/dashboard\/payment-links\/[0-9a-f-]{36}$/);
    await dash.getByRole("heading", { name: "Payment link" }).waitFor();
    const statusBadge = dash.locator(".dash-status").first();
    check("the new link's page says Active", /active/i.test(await statusBadge.innerText()), await statusBadge.innerText());
    const linkUrl = await dash.locator('a[href*="/pay/"]').first().getAttribute("href");
    check("the link page shows the checkout URL", Boolean(linkUrl && linkUrl.startsWith(`${WEB}/pay/`)), linkUrl ?? "none");
    const linkPage = dash.url();
    await shot(dash, "2-link-created");

    // 3. The customer pays.
    current = pay;
    await pay.goto(linkUrl);
    const payButton = pay.getByRole("button", { name: /^Pay 12\.345 BHD/ });
    await payButton.waitFor();
    check("checkout shows the amount in BHD with three decimals", true, "Pay 12.345 BHD");
    check("checkout names the merchant", (await pay.getByText(/^Pay .+/).first().innerText()).length > 4);
    await shot(pay, "3-checkout");

    await pay.getByLabel("Card number").fill("4000000000000002");
    await pay.getByLabel("CVV").fill("123");
    await payButton.click();
    const alert = pay.getByRole("alert");
    await alert.waitFor();
    check("a declined card is reported and the form stays", /declined/i.test(await alert.innerText()) && (await payButton.isVisible()), await alert.innerText());
    await shot(pay, "4-declined");

    await pay.getByLabel("Card number").fill("4242424242424242");
    await payButton.click();
    await pay.getByRole("heading", { name: /^Paid to / }).waitFor();
    check("an approved card ends on the receipt", (await pay.title()).includes("Payment received"), await pay.title());
    await shot(pay, "5-paid");

    // 4. The merchant sees it paid.
    current = dash;
    await dash.goto(linkPage);
    await dash.getByRole("heading", { name: "Payment link" }).waitFor();
    const paidBadge = await dash.locator(".dash-status").first().innerText();
    check("the merchant's link page now says Paid", /paid/i.test(paidBadge), paidBadge);
    const txnLink = dash.locator('a[href*="/dashboard/transactions/"]').first();
    await txnLink.click();
    await dash.waitForURL(/\/dashboard\/transactions\/[0-9a-f-]{36}$/);
    await dash.getByRole("heading", { name: "Transaction" }).waitFor();
    await dash.locator(".dash-status").first().waitFor();
    const txnStatus = await dash.locator(".dash-status").first().innerText();
    const txnText = await dash.locator("main").innerText();
    check("the transaction page shows the payment as captured", /12\.345/.test(txnText) && /captured/i.test(txnStatus), txnStatus);
    await shot(dash, "6-transaction");
  } catch (err) {
    check("browser flow completed", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
    await shot(current, "failure", true).catch(() => {});
    console.error(`Screenshot of the failing page: ${join(ARTIFACTS, "failure.png")}`);
  } finally {
    check("no page errors or console errors", problems.length === 0, problems.slice(0, 3).join(" | "));
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
