# Fix report: reconciliation priced pending captures at the wrong rate

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium. Every merchant on a negotiated fee schedule saw a false gap for any capture not yet in a batch. Half-fil fees produced 1-fil gaps for everyone. |
| **Component** | `apps/api/src/settlement/query.ts` (`getReconciliationReport`), `apps/api/src/fees/` |
| **Found** | End-to-end check, 2026-10-30. Alpha Retail is on a 225 bps schedule, but pending was priced at 250 bps: 31 fils off on a 12.345 BHD payment. |

## Summary

"Pending, not yet batched" is what settlement will pay for captures it hasn't
batched yet. It was estimated from `merchants.mdr_bps`, with a comment saying a
0046 trigger kept that column in sync with `fee_schedules`. No such trigger
exists. The only triggers in the database are the ledger balance check and the
outbox notify.

`merchants.mdr_bps` is the fallback for merchants without a schedule. Capture
and CloseBatch both resolve the schedule row in effect at the capture. The
estimate also used float maths with `Math.round` (half up), while every money
path rounds half to even.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `fees: price a capture the way settlement will, in the API` | `effectiveMdrBpsAt` and `settlementFeeFils` mirror CloseBatch's `EffectiveMdrBpsAt` and `ComputeSettlementFee` in integer fils. Pure unit tests. |
| 2 | `api: price pending captures in reconciliation the way settlement will` | Pending uses the schedule in effect at each capture, less the platform volume tier, with the discount. Removes the float `estimate.ts` and the false trigger comment. |
| 3 | `test: reconciliation prices pending at the negotiated fee schedule` | Fails before the fix (12,036 vs 12,067), passes after. |
| 4 | `test: reconciliation rounds a half-fil pending fee like the ledger` | 252.5 fils → 252. Fails before the fix (1 fil), passes after. |
| 5 | `docs: fix report for reconciliation pending rates` | This file. |

## Verified

All 8 reconciliation route tests pass. The end-to-end run now reconciles to 0
with one payment settled and one pending.

## Found along the way, not changed here

These need a product or finance decision on which side is right, so they are
recorded rather than fixed:

> **Update 2026-10-30:** items 1 and 2 are fixed in
> [`docs/improvements/06`](../improvements/06-negotiated-discount-consistency.md)
> (the capture fee now includes the discount, computed like settlement, on
> every capture path). Item 3 is fixed in
> [`docs/improvements/07`](../improvements/07-fee-schedule-tie-break.md).

1. **Payment-link captures never get the negotiated discount posted.**
   `applyCaptureDiscountAdjustment` runs only in the API capture route
   (`routes/transactions.ts`), not in `paymentLinks/pay.ts`. There is a note:
   *"discountAdjustment is applied by the transactions route only"*. CloseBatch
   does apply the discount. For a discounted merchant paid through a link, the
   ledger therefore charges the full fee while settlement pays the discounted
   one, and reconciliation correctly shows that difference as a gap.
2. **The discount is computed two different ways.** At capture it comes off the
   fee: `rate(rate(amount, mdr), discount)`. At settlement it comes off the
   amount first: `rate(amount − rate(amount, discount), mdr)`. These can differ
   by a fil through rounding.
3. **(Fixed, improvement 07)** **Fee schedule ties are not broken the same way.** CloseBatch loads
   schedules ordered by `effective_from` only. The API breaks ties on
   `created_at`. Two rows with the same `effective_from` could resolve
   differently on each side.

None of these affect merchants without a negotiated discount or duplicate
schedule dates, which covers everyone in the seed data except where noted.
