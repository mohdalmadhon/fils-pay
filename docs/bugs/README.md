# Bug sweep (2026-10-30)

People reported many bugs, so the code was searched area by area (payments
and checkout; sign-in, admin and webhooks; settlement, reporting and money;
the three web apps; database, seed, scripts and deployment). Every report
was checked by hand before anything changed: a bug is listed here only if it
could be reproduced, usually with a test that failed before the fix and
passes after it. Reports that turned out not to be bugs are listed at the
bottom, so nobody chases them again.

Load and capacity work (overload guard, pool sizing, balance-cache timing,
reporting pass spacing, `scripts/load`, `docs/perf`) was left alone: another
person is working on it.

Each bug has its own file and its own commit. The commit message says why
it was a bug, where it was and what the fix was; the file says the same in
more detail, with how to reproduce it.

Numbers are grouped by area, so there are gaps: 001-019 payments, checkout
and refunds; 020-039 settlement and reporting; 040-059 sign-in, admin,
webhooks and the reporting API; 060-079 the dashboard, checkout page and
admin console; 080-099 database, seed, scripts and deployment.

In total 66 bugs were confirmed and fixed. Fewer than the "over 100" that
were reported: several reports turned out to be the same bug, already fixed
earlier (see `docs/fixes`, `docs/cyper`, `docs/improvements`), or not a bug.

| # | Bug | Area | Severity |
|---|---|---|---|
| [001](001-settlement-summary-double-counts-partial-captures.md) | Settlement summary counts a payment captured in parts more than once | API: settlement | High |
| [002](002-capture-idempotency-key-replays-other-transaction.md) | Reusing a capture Idempotency-Key on another transaction replays the first one | API: payments | High |
| [003](003-failed-checkout-leaves-link-reserved.md) | A checkout attempt that errors leaves the payment link stuck as "reserved" | API: payment links | Medium |
| [004](004-failed-checkout-capture-leaves-authorization-open.md) | When checkout's capture fails, the buyer's authorization is left open | API: payment links | Medium |
| [005](005-capture-after-authorization-expired.md) | An authorization can still be captured after its 7-day hold has lapsed | API: payments | Medium |
| [006](006-recapture-after-refund-wrong-status.md) | Capturing the rest of a payment after a refund marks it 'captured' and forgets the refund | API: payments | Low |
| [007](007-refund-rest-of-spent-partial-capture-wrong-error.md) | Refunding "the rest" of a fully refunded partial capture answers "bad amount" instead of "not refundable" | API: refunds | Low |
| [008](008-malformed-amounts-and-cards-500.md) | Malformed amounts or card details on authorize, capture and checkout return a 500 | API: payments | Low |
| [009](009-zero-amount-payment-link-500.md) | Creating a payment link for 0 fils returns a 500 | API: payment links | Low |
| [010](010-invalid-date-filters-500.md) | Invalid or impossible dates in transaction and settlement filters return a 500 | API: transactions, settlement | Low |
| [011](011-tampered-page-cursor-500.md) | A tampered page cursor on the transactions, payment-links or settlement lists returns a 500 | API: lists | Low |
| [012](012-malformed-path-id-500.md) | A malformed id in the URL of transaction, settlement-batch or payment-link routes returns a 500 | API: transactions, settlement, payment links | Low |
| [013](013-acquirer-callback-values-not-validated.md) | The acquirer callback stores any outcome and retries errors that can never succeed | API: acquirer callbacks | Low |
| [014](014-refund-leaves-balance-cache-stale.md) | A refund leaves the merchant's cached payable balance too high | API: refunds | Medium |
| [015](015-capture-fee-priced-on-app-clock.md) | Capture and settlement can charge different fees when a fee schedule starts mid-capture | API: payments | Low |
| [016](016-checkout-retry-after-success-409.md) | A buyer's retry of a successful checkout (same Idempotency-Key) gets 409 instead of the original 200 | API: payment links | Low |
| [020](020-closing-a-day-early-loses-its-later-captures.md) | Closing a business day early loses that day's later captures | Settlement: batch close | High |
| [021](021-one-merchant-error-stops-the-daily-run.md) | One merchant's error stops the daily settlement run for everyone after it | Settlement: daily run | High |
| [022](022-refunds-never-deducted-from-payouts.md) | Refunds are never taken off the merchant's payout | Settlement: payouts | High |
| [023](023-reconciliation-shows-unbatched-refund-as-gap.md) | Reconciliation report shows a refund as an unexplained gap | API: settlement reconciliation | Medium |
| [024](024-reporting-stuck-on-missing-rollup-row.md) | Reporting gets stuck when a day has no rollup row | Reporting: consumer | Medium |
| [025](025-suspended-merchant-paid-for-closed-batch.md) | A suspended or test-mode merchant still gets paid for an already-closed batch | Settlement: batch close | Low |
| [026](026-unbatched-captures-view-misses-partial-captures.md) | The unbatched-captures view leaves out partial captures | DB: views | Low |
| [027](027-reporting-config-accepts-15s-as-15.md) | Reporting config reads "15s" as 15 and "1.5e4" as 1 | Reporting: config | Low |
| [028](028-settlement-daemon-timing-settings-unchecked.md) | Bad settlement daemon timing settings crash it or stop it from ever running | Settlement: config | Low |
| [040](040-split-credits-skip-second-approver.md) | Splitting a credit into small ones skipped the second approver | Admin: credits | Medium |
| [041](041-client-errors-answered-as-500.md) | Bad JSON, an oversize body or a wrong Content-Type came back as a 500 | API: error handler | Medium |
| [042](042-saved-filters-no-role-gate-or-cap.md) | Anyone signed in to a merchant could save report filters, with no limit | API: reporting | Low |
| [043](043-report-filter-bad-values-give-500.md) | A bad report filter crashed with a 500 | API: reporting | Low |
| [044](044-bad-list-cursor-or-repeated-q-gives-500.md) | A bad page cursor or a repeated ?q= crashed list pages with a 500 | Admin lists, webhook deliveries | Low |
| [045](045-non-uuid-path-ids-and-bad-webhook-status-give-500.md) | A non-UUID id in a merchant URL, or a bad webhook status, gave a 500 | API: webhooks, API keys, KYC | Low |
| [046](046-signup-and-profile-fields-not-validated.md) | Signup and profile edits didn't check their fields, and failed signups used up the quota | API: onboarding | Low |
| [047](047-login-with-non-string-email-gives-500.md) | Login with a number or object as the email crashed with a 500 | API: sign-in | Low |
| [048](048-analytics-accepts-impossible-dates.md) | Analytics accepted dates like 2026-02-30 and then crashed with a 500 | API: analytics | Low |
| [049](049-unknown-import-merchant-and-huge-delta-give-500.md) | An unknown merchant in an adjustment CSV, or a huge balance delta, gave a 500 | Admin: adjustments | Low |
| [050](050-import-total-sums-signed-amounts.md) | An adjustment import's total cancelled out credits against debits | Admin: adjustment import | Low |
| [051](051-admin-logout-leaves-view-as-unaudited.md) | Admin logout stopped view-as sessions without recording that they ended | Admin: sign-in | Low |
| [052](052-admin-settlement-dates-and-errors.md) | Admin settlement actions accepted impossible dates, reported settlement's "no" as a 500, and hid a logging failure | Admin: settlement | Low |
| [060](060-view-as-merchant-lands-on-login.md) | "View as merchant" lands on the merchant login page | API sign-in + dashboard | High |
| [061](061-transaction-date-filter-uses-utc-days.md) | Transaction date filters use UTC days, not Bahrain business days | Dashboard: transactions | Medium |
| [062](062-list-pages-show-stale-filter-results.md) | List pages can show results for an old filter | Dashboard + admin: lists | Medium |
| [063](063-bulk-kyc-approves-hidden-merchants.md) | Bulk KYC approval can approve merchants that are no longer on screen | Admin: merchants | Medium |
| [064](064-expired-payment-links-show-active.md) | Expired payment links show as "Active" and offer Cancel | Dashboard: payment links | Medium |
| [065](065-checkout-unapproved-merchant-says-try-again.md) | Checkout tells the customer to "try again" when the merchant isn't approved | Checkout | Medium |
| [066](066-expired-session-login-bounces-back.md) | After the session expires, the login page bounces back into the dashboard | Dashboard + admin: sign-in | Medium |
| [067](067-settlement-rerun-defaults-to-two-days-ago.md) | Settlement re-run date defaults to two days ago after midnight | Admin: settlement | Low |
| [068](068-credit-effective-date-uses-browser-date.md) | Credit effective date defaults to the browser's date, not Bahrain's | Admin: credits | Low |
| [069](069-view-as-merchant-always-says-tab-blocked.md) | "View as merchant" always says the browser blocked the new tab | Admin: merchants | Low |
| [070](070-credit-form-shows-base-mdr-for-fee-reversal.md) | Credit form shows the base MDR as the fee-reversal rate | Admin: credits | Low |
| [071](071-checkout-accepts-expired-card.md) | Checkout and the API accept an expired card | Checkout + API: payments | Low |
| [072](072-overview-days-label-counts-days-with-data.md) | Overview says "in the last N days" using the number of days with data | Dashboard: overview | Low |
| [073](073-staleness-badge-shows-only-a-time.md) | The analytics "Data as of" badge shows only a time | Dashboard: overview | Low |
| [074](074-settlement-batch-fake-progress-bar.md) | Settlement batch page shows a "progress bar" made from the amount | Dashboard: settlement | Low |
| [075](075-webhook-url-error-hides-server-reason.md) | Webhook URL errors always say "Enter a full https:// address" | Dashboard: webhooks | Low |
| [080](080-deploy-from-windows-sends-crlf-scripts.md) | Deploying from Windows sends scripts the server cannot run | Ops: deploy | High |
| [081](081-seed-prints-dead-api-keys.md) | The seed prints two sets of API keys, and the first set does not work | DB: seed | Medium |
| [082](082-deploy-ignores-changed-site-host-and-http-only.md) | A redeploy ignores new SITE_HOST, OPS_HOST and HTTP_ONLY settings | Ops: deploy | Medium |
| [083](083-refund-merchant-summary-always-empty.md) | The refund summary view is always empty | DB: views | Medium |
| [084](084-ledger-check-misses-group-a-leg-left.md) | The ledger balance check misses the group a leg was moved out of | DB: ledger | Low |
| [085](085-deploy-passes-host-name-as-public-ip.md) | Deploying to a host name sends the name as the server's IP | Ops: deploy | Low |
| [086](086-failed-first-deploy-then-retry-loses-env.md) | Retrying a failed first deploy deletes the only copy of the settings | Ops: deploy | Low |
| [087](087-tests-that-cannot-fail.md) | Two integration tests never ran the code they were named after | Tests | Low |
| [088](088-e2e-check-uses-replaced-demo-password.md) | The deployment check in ops/README.md signs in with a replaced password | Docs: ops | Low |
| [089](089-readme-gets-pgconn-settlement-backwards.md) | ops/README.md describes PGCONN_SETTLEMENT the wrong way round | Docs: ops | Low |
| [090](090-seed-docs-say-empty-database-only.md) | The deploy docs say SEED=1 only loads into an empty database | Docs: deploy | Low |
| [091](091-seeded-fees-ignore-seeded-fee-schedules.md) | The demo data charges Alpha Retail 2.50% while its fee schedule says less | DB: seed | Low |

## Needs a decision (not changed)

- **Adjustment imports post any amount with no second person.** A finance
  admin who can't approve their own 50.001 BD credit can import a CSV that
  posts 250,000 BD at once (`apps/api/src/admin/adjustmentImport.ts`). The
  route's comment says skipping a review step was a product choice, and
  adding one needs a migration (a pending state plus approver columns on
  `adjustment_imports`). Proposal: above the credit limit (counted on
  absolute amounts) an upload is stored but posts nothing until a second
  finance or super admin approves it, the way credits work.
- **The March residue sweep uses the UTC month.** `scripts/reconcile_march.ts`
  takes March as a UTC month, as ADR 0003 accepted, but `docs/HANDOVER.md`
  says the Bahrain business month. On the seed the two differ by 528
  transactions and 4.750 BD of residue, because the fixture plants activity
  on Bahrain 1 March before 03:00. Finance should pick one, then the ADR or
  the handover note is corrected.
- **A refund larger than a day's payout.** Since bug 022, refunds come off
  payouts, but a payout can't go below zero, so a refund bigger than any
  single day's net waits (and `merchant_payable` stays negative) until a
  large enough batch arrives. Collecting that money another way is a
  product decision.

## Checked and not bugs

Reports that were looked at and turned out fine, so nobody chases them
again: concurrent or over-refunds (the row lock prevents both); fee
reversal over the fee across partial refunds (the cap is exact); capture
after void, void after partial capture (both 409); cross-merchant access on
capture, void, refund, links and batches (all scoped); refund idempotency
(already hashes the transaction); closing or paying a batch twice (row lock
and status checks); split allocation and residue legs (conserve exactly);
Bahrain business-day windows in Go (correct, fixed +3); IPv4-mapped IPv6
webhook targets (blocked); service-role grants (complete); duplicate
migration numbers 0073, 0080 and 0081 (deliberate, apply cleanly);
`expire_holds` (correct predicate); the payment-link list's 100-link limit
and the "Adjust balance" no-ledger behaviour (documented as intended).
