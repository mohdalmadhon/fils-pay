# 06: The negotiated discount was charged three different ways

| | |
|---|---|
| **Type** | Money bug |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | Recorded during the end-to-end check in [`docs/fixes/reconciliation-pending-rate.md`](../fixes/reconciliation-pending-rate.md), items 1 and 2. Code: `apps/api/src/payments/capture.ts:204` (fee), `apps/api/src/routes/transactions.ts:110-117` (separate adjustment call), `apps/api/src/payments/discountAdjustment.ts` (the adjustment), `apps/settlement/internal/settlement/discounted_fee.go` (settlement). |

## What was wrong

A merchant with `negotiated_discount_bps` was charged differently depending
on where you looked:

| Where | Formula | 10,021 fils, 250 bps, 10 % off |
|---|---|---|
| Settlement (`ComputeSettlementFee`) | MDR on (amount − discount × amount) | **225** |
| API capture route | full MDR, then a second transaction reversing discount × fee | 226 |
| Paid payment link | full MDR, no discount at all | 251 |

The rule is written down: `docs/ARCHITECTURE.md` says "Discounts reduce the
amount the MDR is charged on", and `docs/design/settlement-v2.md` says the
same. `CLAUDE.md` says settlement is the reference for fee maths. The
`discountAdjustment.ts` comment cited a "partner-pricing addendum" applying
the discount after the fee; no such document is in the repo.

Consequences:

- The ledger (what the merchant saw as earned) and the payout disagreed for
  every discounted merchant paid through a payment link, and by a fil at
  times through the API.
- The adjustment ran in its own transaction after the capture committed. If
  it failed, the capture stood and the discount was simply lost (a comment
  in the route had asked about this).

## Fix

Capture now posts the fee settlement will charge,
`settlementFeeFils(amount, rate, discount)`. That function was written in the
pending-rate fix to mirror `ComputeSettlementFee`. It applies on every capture
path, inside the capture transaction. The separate adjustment is gone.

| # | Commit |
|---|---|
| 1 | `test: a discounted merchant is charged the settlement fee on both capture paths` (fails before: 226 and 251, want 225) |
| 2 | `payments: charge the negotiated discount inside the capture fee, on every path` |
| 3 | `payments: remove the separate capture discount adjustment` |
| 4 | `docs: mark the discount mismatches in the pending-rate report as fixed` |
| 5 | `docs: improvement 06, negotiated discount consistency` |

## What else changes

- The `transaction.captured` webhook's `feeFils` and the timeline now show the
  fee actually charged, discount included.
- **Old captures** keep their full-MDR fee plus the
  `capture: negotiated discount adjustment` group. Refunds net both
  (`processRefund.ts`), so refunds of old and new captures stay correct.
- `refundFeeReversal.test.ts` checked for an adjustment entry as its
  precondition. It now checks that the net fee is below the full MDR.
- `discountAdjustment.test.ts` tested only the removed function and was
  removed with it.

## Verified

`captureDiscount.test.ts` (2), `refundFeeReversal.test.ts`, `processRefund.test.ts`,
`transactions.test.ts`, `paymentLinks.test.ts`, `settlement.test.ts` and
`adjustmentAmounts.test.ts` pass.

## For finance

Discounted merchants paid through payment links before this change were
charged the full MDR at capture, but settlement paid them out with the
discount. Their `merchant_payable` therefore shows a small negative remainder
after payout. Nothing was over-collected from the merchant (the payout used
the discounted fee), but the ledger needs a one-off correction to match. This
query lists the affected captures. Set the cutoff to when this change was
deployed: captures after it post the discounted fee directly and are correct.

```sql
SELECT t.id, t.merchant_id, te.amount_fils, (te.metadata->>'feeFils')::bigint AS fee_posted
  FROM transaction_events te
  JOIN transactions t ON t.id = te.transaction_id
  JOIN merchants m ON m.id = t.merchant_id
 WHERE te.event_type IN ('captured', 'partially_captured')
   AND m.negotiated_discount_bps > 0
   AND te.occurred_at < '<deploy time>'
   AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                    WHERE le.transaction_id = t.id
                      AND le.description = 'capture: negotiated discount adjustment');
```
