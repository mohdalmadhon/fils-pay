# Verification

End-to-end checks of what FilsPay actually does with money, run against real
services, and their results. Each report records:

- what was asked
- how it was checked
- the results before and after any fixes
- the test-suite state
- what remains open

| Date | Report | Scope |
|---|---|---|
| 2026-10-30 | [end-to-end-2026-10-30.md](end-to-end-2026-10-30.md) | One payment, from link through ledger, fees, settlement and payout, webhooks, timeline, reports and reconciliation. Found and fixed four problems. Dilmun Cloud deployment not yet verified. |

To repeat a check, run `scripts/e2e/payment-check.mjs`. How to run it is in
the report.

## Browser check

`npm run e2e:browser` (`scripts/e2e/browser-check.mjs`) does the same flow the
way people do it, in Chromium: dashboard sign-in with the one-time code,
creating a link from the form, paying it on the checkout page as a separate
customer (a declined card, then an approved one), and the merchant's link
and transaction pages afterwards. It fails on any page error or console
error. CI runs it on every pull request (the "Browser end-to-end" job).

Locally, with a seeded database:

```bash
npx playwright install chromium          # once
# terminal 1: the API, showing one-time codes on the page (local only)
cd apps/api && NODE_ENV=development OTP_DEV_EXPOSE=true npx tsx src/index.ts
# terminal 2: the dashboard
cd apps/web && npx vite
# terminal 3
npm run e2e:browser                      # HEADED=1 to watch, E2E_ARTIFACTS=dir for screenshots
```

On Windows PowerShell, set the variables with `$env:NODE_ENV = "development"`
and `$env:OTP_DEV_EXPOSE = "true"` first. A failure saves a screenshot of the
failing page to `e2e-artifacts/failure.png`.
