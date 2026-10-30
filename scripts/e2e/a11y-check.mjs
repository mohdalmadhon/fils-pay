#!/usr/bin/env node
/**
 * Accessibility check: runs axe-core (WCAG 2.1 A and AA, plus axe's best
 * practices) on every dashboard page and the public checkout page, in
 * Chromium, for every look: the three designs (Orchid, Lagoon, Saffron) in
 * light and dark, and the Halloween costume. Write-up:
 * docs/improvements/18; the designs: docs/design/README.md.
 *
 * LOOKS=orchid-light,lagoon-dark limits the run to some looks.
 *
 * Any violation fails the run, with the rule, the elements and axe's
 * explanation. axe finds about a third of real problems: keyboard use,
 * focus order and how a screen reader actually reads a page still need a
 * person (see the write-up for what was checked by hand).
 *
 * Usage (from the repo root, with the API and the dashboard running, as for
 * scripts/e2e/browser-check.mjs):
 *   API_URL=http://localhost:3000 WEB_URL=http://localhost:5173 \
 *   node scripts/e2e/a11y-check.mjs
 *
 * Optional: MERCHANT_ID, MERCHANT_EMAIL, MERCHANT_PASSWORD (default: the
 * seed's Alpha Retail owner). Creates one payment link.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const API = process.env.API_URL ?? "http://localhost:3000";
const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const MERCHANT_ID = process.env.MERCHANT_ID ?? "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = process.env.MERCHANT_EMAIL ?? "owner@alpharetail.example";
const PASSWORD = process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026";
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
const DASHBOARD_PAGES = [
  "transactions",
  "payment-links",
  "payment-links/new",
  "settlement",
  "reconciliation",
  "overview",
  "webhooks",
  "webhooks/new",
  "settings",
];

const ALL_LOOKS = ["orchid-light", "orchid-dark", "lagoon-light", "lagoon-dark", "saffron-light", "saffron-dark", "halloween"];
const LOOKS = process.env.LOOKS ? process.env.LOOKS.split(",") : ALL_LOOKS;

let failures = 0;
let pagesChecked = 0;

async function audit(page, name) {
  await page.waitForLoadState("networkidle");
  // Let entrance animations finish so colours are measured at rest.
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: tags }), RULES);
  pagesChecked += 1;
  if (result.violations.length === 0) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}`);
  for (const v of result.violations) {
    console.log(`      ${v.impact} ${v.id}: ${v.help} (${v.nodes.length})`);
    for (const node of v.nodes.slice(0, 5)) {
      const why = (node.failureSummary ?? "").split("\n").slice(1).join(" ").trim();
      console.log(`        ${node.target.join(" ")}  ${why}`);
    }
  }
}

async function signIn(page, theme) {
  await page.goto(`${WEB}/dashboard/login`);
  await audit(page, `${theme}: sign-in`);
  await page.getByLabel("Merchant ID").fill(MERCHANT_ID);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use it" }).click();
  await audit(page, `${theme}: one-time code`);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL(/\/dashboard\/transactions/);
}

async function dashboardPages(page, theme) {
  for (const path of DASHBOARD_PAGES) {
    await page.goto(`${WEB}/dashboard/${path}`);
    await audit(page, `${theme}: /dashboard/${path}`);
  }
  // A detail page of each kind, reached the way a person would.
  await page.goto(`${WEB}/dashboard/payment-links`);
  await page.waitForLoadState("networkidle");
  const link = page.locator('a[href^="/dashboard/payment-links/"]:not([href$="/new"])').first();
  if (await link.count()) {
    await page.goto(WEB + (await link.getAttribute("href")));
    await audit(page, `${theme}: payment link detail`);
  } else {
    console.log(`SKIP  ${theme}: payment link detail (no payment links yet)`);
  }
  await page.goto(`${WEB}/dashboard/transactions`);
  await page.waitForLoadState("networkidle");
  const txn = page.locator('a[href^="/dashboard/transactions/"]').first();
  if (await txn.count()) {
    await page.goto(WEB + (await txn.getAttribute("href")));
    await audit(page, `${theme}: transaction detail`);
  } else {
    console.log(`SKIP  ${theme}: transaction detail (no transactions yet)`);
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    // Each look in its own browser context (the choice is per browser).
    // "halloween" is the costume (components/kit/Halloween.tsx) over Orchid.
    for (const theme of LOOKS) {
      const context = await browser.newContext();
      await context.addInitScript((look) => {
        const [design, mode] = look === "halloween" ? ["orchid", "dark"] : look.split("-");
        try {
          window.localStorage.setItem("fp-appearance", JSON.stringify({ design, mode, layout: "sidebar", density: "comfortable" }));
          window.localStorage.setItem("fp-costume", look === "halloween" ? "halloween" : "off");
        } catch {
          /* storage blocked: the defaults apply */
        }
      }, theme);
      const page = await context.newPage();
      await signIn(page, theme);
      await dashboardPages(page, theme);

      {
        // The public checkout page, for a fresh link, in the same theme.
        const created = await page.evaluate(
          async ([api, merchantId]) => {
            const res = await fetch(`${api}/v1/merchants/${merchantId}/payment-links`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ amountFils: 12_345, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
            });
            return res.json();
          },
          [API, MERCHANT_ID],
        );
        const customer = await context.newPage();
        await customer.goto(created.url);
        await customer.getByRole("button", { name: /^Pay / }).waitFor();
        await audit(customer, `${theme}: checkout`);
        await customer.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${pagesChecked - failures} of ${pagesChecked} pages passed`);
  process.exit(failures === 0 && pagesChecked > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
