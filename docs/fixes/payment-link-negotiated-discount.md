# Fix report: payment-link checkout skipped the negotiated discount

Confirmed on main `d18020f`, 2026-10-30. This fixes the payment-link-to-payout
flow; it does not implement the separate FP-212 refunds feature.

## Problem and reproduction

Public checkout called `captureTransactionWithClient` directly. Only the
merchant transaction capture route subsequently called the discount helper.
As a result, checkout posted the full MDR fee, while settlement applied the
negotiated discount. Each ledger group balanced, but the merchant's net
earnings did not cover the payout, so reconciliation correctly found a gap.

On a fresh migrated/seeded database, paying Delta Marketplace's link for
47.333 BD reproduced:

| Quantity | Before | After |
|---|---:|---:|
| Gross captured | 47,333 fils | 47,333 fils |
| Initial MDR fee, 275 bps | 1,302 | 1,302 |
| Negotiated-discount credit | 0 | 163 |
| Net fee in the ledger and capture timeline/webhook | 1,302 | 1,139 |
| Settlement fee | 1,139 | 1,139 |
| Payout | 46,194 | 46,194 |
| Payable after payout / reconciliation gap | −163 | 0 |

The discount is 1,250 bps (12.5%). The established settlement formula first
rounds the discounted gross, then applies MDR. The shared adjustment helper
already implements that formula; this fix uses it rather than introducing a
second pricing calculation. Scheme truncation still produces 47,330 fils
and the existing 3-fil residue posting.

## Implementation

- [discountAdjustment.ts](../../apps/api/src/payments/discountAdjustment.ts):
  extract `applyCaptureDiscountAdjustmentWithClient`. The existing pool-based
  function remains a wrapper for its callers. The same transaction ownership
  check, event completion markers, legacy-history guard, pricing snapshots,
  balanced adjustment legs, and cache update remain in use. The helper returns
  the adjusted event ID and its original/net fee to checkout.
- [pay.ts](../../apps/api/src/paymentLinks/pay.ts): after successful capture,
  apply the discount on checkout's existing SQL client, before marking the
  link paid. Capture, rebate, cache delta, event marker and link finalization
  now commit or roll back together. A fresh full checkout must have exactly
  one newly adjusted capture; an unexpected state aborts instead of silently
  completing without the adjustment. Reservation and single-charge locking
  are preserved.
- In that same transaction, checkout sets the new capture timeline's
  `metadata.feeFils` and the new capture outbox's `payload.feeFils` to the net
  fee. The timeline retains `feeBeforeDiscountFils` and
  `negotiatedDiscountAppliedFils` as the explanation. The webhook dispatcher
  cannot observe an uncommitted capture, so it publishes the final net fee.
  No previously delivered webhook is edited or resent.
- [payment-check.mjs](../../scripts/e2e/payment-check.mjs): compare **net**
  payable and fee legs with the timeline, including the balancing rebate.
  Counting gross credit legs alone incorrectly rejects a valid discount.
- [payment-link-discount.verify.mjs](../../scripts/e2e/payment-link-discount.verify.mjs):
  new regression probe against actual checkout and PostgreSQL, with a scripted
  acquirer. Existing locked tests and frozen money packages are unchanged.

The merchant transaction capture route retains its existing wrapper and
behavior. This fix does not claim to make that route's separate post-capture
adjustment atomic, or to snapshot historical settlement rates when pricing
changes between capture and close.

## Verification

The new regression probe fails before the fix with `1302 !== 1139` for the
timeline fee. It passes after the fix and covers:

- The 47,333-fil discounted checkout: exact 163-fil credit, 1,139-fil net fee,
  46,194-fil payable/cache, and matching timeline/outbox.
- No discount: unchanged 1,302-fil fee and no rebate.
- A 21-fil payment where the net fee rounds to zero: a 1-fil rebate, using
  the established settlement rounding rule.
- Replay: one charge and no additional adjustment when the helper or pay
  request is repeated.
- A synthetic database failure at link finalization, after the rebate was
  posted: capture, rebate, cache, timeline and capture outbox all roll back.
  This tests database atomicity, not reversal of an external acquirer charge.
- A one-connection pool, ensuring checkout does not open a nested transaction
  that waits for its own capture lock.

Actual local API + PostgreSQL + settlement binary + webhook receiver runs:
Alpha Retail **20/20** and Delta Marketplace **20/20**, without skipped checks.
Delta's signed capture webhook carries fee 1,139; its payout is 46,194 and
its reconciliation gap is zero. Another **20 API report checks** pass across
both merchants: timeline fee breakdown, payout trends, transaction report,
top links, batch transactions, volume totals, settled reconciliation, a second
pending payment, reporting catch-up and replay. Delta's pending 12,345-fil
payment has a 297-fil net fee, and the mixed settled/pending window still
reconciles to zero. Reporting catch-up succeeds. These runs use
the repository's simulated acquirer; live card/bank rails are not verified.

The existing discount replay and Go/API rounding probes (audit 06 and 09)
pass. Fresh migration applies all 77 files, seed assertions pass, and type
checking passes. Verification used isolated local PostgreSQL 18.6 databases.

| Full check | Result |
|---|---|
| `npm test`: API | 516/518; the existing schedule-display expectation and webhook backoff test still fail |
| `npm test`: reporting | 7/11; the same four baseline failures |
| Events / money / web suites | 4/4, 40/40, 8/8 |
| `node --import tsx --test scripts/*.test.ts` | 10/10 |
| `go test ./...` | The same four existing `RecalculateMDR` failures; other packages pass |
| `npm run typecheck` | Pass |

There are no new existing-suite failures. The full suite is not green; the
baseline failure identities are recorded in the
[audit disposition](../audits/future-fixes-disposition.md#verification).
No existing regression test was changed to obtain a pass.
Local run logs are under `/tmp/filspay-payment-link-discount-fix/`; the
before-fix reproduction is under `/tmp/filspay-feature-verification/`.

Run on a disposable migrated/seeded database only:

```bash
node --import tsx scripts/e2e/payment-link-discount.verify.mjs
node --import tsx scripts/future-fixes/06.verify.mjs
node --import tsx scripts/future-fixes/09.verify.mjs

# API running with OTP_DEV_EXPOSE=true, DATABASE_URL matching that API,
# and SETTLEMENT_BIN pointing at the current settlement binary:
node scripts/e2e/payment-check.mjs
MERCHANT_ID=eebd4250-3e67-4999-9ce9-f31e75486733 \
MERCHANT_EMAIL=owner@deltamarketplace.example \
node scripts/e2e/payment-check.mjs
```

Use a fresh database for the API runs: settlement closes each merchant's day
once. The regression probe creates fixture merchants; it is separate from
the normal Alpha/Delta end-to-end scenarios.

## Deployment and historical records

No migration is needed. Restart/deploy the API to use the corrected checkout.
There is no new settlement fee policy or change to the scheme file.

Existing paid links, completed batches and historical ledger entries are not
rewritten. Finance must review historical discounted payment-link captures,
their actual fee legs, prior adjustments and payouts before approving any
correction. An existing gap is not automatically erased by deploying this
code or by rebuilding the balance cache. A blanket replay/backfill is not
included.

The external-acquirer crash/recovery limitation already recorded in the
[single-charge fix](payment-link-double-charge.md#related-not-changed-here)
remains separate from database transaction atomicity.

## References and history

- [Original acceptance checklist and verification](../verification/end-to-end-2026-10-30.md):
  API, ledger to the fil, fees/payouts, webhooks, timeline/reports/reconciliation.
  Its Alpha scenario passed while this discounted-merchant case remained open.
- [First explicit finding](reconciliation-pending-rate.md#found-along-the-way-not-changed-here).
- [Single-charge report's related issues](payment-link-double-charge.md#related-not-changed-here).
- [Future-fixes disposition](../audits/future-fixes-disposition.md#scope-corrections-and-remaining-work).
- [Audit 06](../future-fixes/06.md), commit `e8ebbb4`: per-capture adjustment
  markers, including zero; this fix reuses them.
- [Audit 09](../future-fixes/09.md), commit `8320272`: capture/settlement
  rounding parity; the missing checkout call remained a separate issue.
- [Audit 07](../future-fixes/07.md), commit `bec59d0`: ledger-driven cache
  updates; the rebate uses its existing delta helper.
- Relevant source history: `6a076df` added payment-link checkout;
  `57c6afc` made capture/finalization atomic under the reservation lock;
  `6cdde6a` added suspended-merchant enforcement. These safeguards remain.
