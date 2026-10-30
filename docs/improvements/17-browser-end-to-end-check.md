# 17: Nothing tested the dashboard or checkout in a browser

| | |
|---|---|
| **Type** | Test coverage |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `apps/web` had one test file, `src/dashboard.test.ts`, which covers query strings and money formatting. `scripts/e2e/payment-check.mjs` covers the money flow over HTTP only. No test ever loaded a page, so nothing covered the router, the forms, the cross-origin session cookie or the checkout page that customers pay on. |

## Why it matters

The parts most likely to break in a demo or in production are the ones the
API tests can't see:

- **The session cookie.** The dashboard (`:5173`) and the API (`:3000`) are
  on different origins. Sign-in only works because of three things together:
  `credentials: "include"`, CORS with credentials, and the cookie
  attributes. Change any one and the dashboard can't sign in, while every
  API test still passes.
- **The forms.** If a label changes, a required field has no default, or a
  route moves, the page breaks but the API tests stay green. For example,
  the "Expires at" field on the new-link form is required and starts empty.
  The browser check had to fill it in, which a person may not expect.
- **The checkout page.** It is the only page a customer ever sees, and
  nothing tested it.

## Fix

`scripts/e2e/browser-check.mjs` uses Playwright with Chromium and runs 11
checks:

1. Dashboard sign-in. The password step leads to the one-time-code step;
   the development code is shown and used; sign-in lands on Transactions.
2. A new link is created from the form. Its page says Active and shows the
   checkout URL.
3. A separate customer opens the link in a browser context with no cookies.
   The page shows "Pay 12.345 BHD" (three decimals, so mixing up fils and
   cents would show), and its heading names the signed-in merchant. (As
   first committed, this check matched the Pay button and could not fail.
   Fixed in [19](19-review-follow-ups.md).)
4. A declined card is reported, and the form stays so the customer can
   retry.
5. An approved card ends on the receipt.
6. The merchant's link page now says Paid, and its transaction page says
   Captured.
7. No page errors or console errors occurred anywhere. Chromium's own
   "Failed to load resource" lines are left out because the page handles
   those itself (the 401 session check before sign-in, the 402 decline).

If a step fails, a screenshot of the failing page is saved to
`e2e-artifacts/`.

| # | Commit |
|---|---|
| 1 | `build: add Playwright for a browser end-to-end check`: `playwright` 1.63.0 pinned as a root dev dependency, and the `npm run e2e:browser` script |
| 2 | `e2e: sign in, create a payment link and pay it in a real browser` |
| 3 | `ci: run the browser end-to-end check on every pull request`: a new "Browser end-to-end" job (Postgres, migrate, seed, the API in development mode, the built dashboard via `vite preview`; screenshots and logs uploaded if it fails) |
| 4 | `docs: how to run the browser end-to-end check`: `docs/verification/README.md` (including PowerShell), `docs/ONBOARDING.md` |
| 5 | `docs: improvement 17, browser end-to-end check` |

## Verified

- On a new, seeded database, with the API on `OTP_DEV_EXPOSE=true`:
  **11 passed, 0 failed**, against both `vite` (dev) and the built dashboard
  under `vite preview` (what CI runs).
- **It catches a real break.** With `credentials: "include"` removed from
  `apps/web/src/api/client.ts` and the dashboard rebuilt, the check failed
  at sign-in. Restoring the line brought it back to 11/11.
- `npm run audit:prod` still reports 0 vulnerabilities, because Playwright
  is a dev dependency only.
- The workflow file parses. The job itself can only run on GitHub. Add
  **Browser end-to-end** to the required checks
  ([10](10-ci.md)).

## Not covered

- The Ops console (`apps/admin`) has no browser check yet. The same pattern
  would work there.
- Only Chromium is tested, not Firefox or WebKit.
