# 19: Follow-ups from an independent review of 15–18

| | |
|---|---|
| **Type** | Review fixes |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | A separate reviewer read the code for improvements 15–18 without having seen it written. It found no high-severity problems. It found two medium and five low ones, and confirmed findings 2 and 3 by running them. |

## Findings and fixes

| # | Finding | Severity | Where | Fix |
|---|---|---|---|---|
| 1 | The migration checksum check wasn't atomic. Its `RECORD` and `ACCEPT` updates committed one at a time, so a refused run could still save an accepted checksum, and the message "Nothing was applied" was false. There was also no lock, so two runners could start together. | medium | `db/migrate.ts` (`verifyAppliedChecksums`) | The check and its updates now commit together or roll back. The whole run holds `pg_advisory_lock`. A new test in `db/migrateChecksum.test.ts` failed before the fix. With two concurrent runs on an empty database, one applied 76 migrations and the other applied none. |
| 2 | The browser check "checkout names the merchant" couldn't fail, because it matched the Pay button. | medium | `scripts/e2e/browser-check.mjs` | It now reads the page's `h1` and compares it with the signed-in merchant's name from `/v1/auth/me`. |
| 3 | In the Halloween costume, the checkout payee line (made an `h1` in 18) picked up the costume's gradient heading style. | low | `CheckoutPage.tsx` / `theme.css` | A rule in `CheckoutPage.css` keeps it plain text, as it was when it was a `<p>`. Its computed style is now the costume's ink colour with no gradient (screenshot checked). |
| 4 | For a suspended merchant, a payment already in flight showed as `unavailable` ("No payment was taken"), even though it can still capture. | low | `apps/api/src/paymentLinks/status.ts` | The merchant check now applies only to links that could take a new payment. A reserved link reads as `processing`, which a new test covers. |
| 5 | The Halloween costume's contrast wasn't audited automatically, and the accessibility check skipped detail pages without saying so. | low | `scripts/e2e/a11y-check.mjs`, doc 18 | It now audits three looks: light, night and the costume, with the checkout page in each. That makes 39 of 39 pages passing. A skipped page prints `SKIP`. Doc 18 is corrected. |
| 6 | The CI step built the dashboard in the background inside the 60-second wait. A broken build showed up only as "servers did not start", and the background servers could hold the step open. | low | `.github/workflows/ci.yml` | `vite build` is now its own foreground step. The servers start with `nohup` and stdin closed. |
| 7 | A comment said `pay.ts` uses `derivePublicStatus`; it doesn't. | low | `status.ts` header | The comment now says where `pay.ts` makes the same decision, and which test keeps the two in step. |

| # | Commit |
|---|---|
| 1 | `migrate: check checksums in one transaction, one runner at a time` (finding 1) |
| 2 | `payment-links: a payment in flight stays 'processing' after a suspension` (findings 4 and 7) |
| 3 | `web: the checkout payee line keeps its look in the Halloween costume` (finding 3) |
| 4 | `e2e: checks that can fail, the costume audited, CI builds in the foreground` (findings 2, 5 and 6) |
| 5 | `docs: improvement 19, review follow-ups` (corrections to 17, 18 and the index) |

## Kept as it is

- **The first checksum run trusts the files on disk.** A database that
  predates checksums records whatever files are there on its first run.
  `db/migrate.ts` and the RUNBOOK say to do that first run from `main`.
  The alternative would be to refuse until someone confirms every file,
  which would block every existing environment.

## Verified

- `npm run test:db`: 6/6.
- Payment-link tests: 23/23, including the new in-flight case.
- `npm run e2e:browser`: 11/11.
- `npm run e2e:a11y`: 39/39.
- The workflow file parses.
