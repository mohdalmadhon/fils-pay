# 022: Refunds are never taken off the merchant's payout

**Severity:** High. A merchant was paid in full for payments that had been
refunded to the cardholder, so the platform paid that money out twice.

## Where

`apps/settlement/internal/settlement/batch.go`, `CloseBatch`.

## Why it was wrong

A refund (`apps/api/src/payments/processRefund.ts`) debits
`merchant_payable` by the refund amount and credits back the fee it
reverses. It also writes a `refunds` row whose `settlement_batch_id` stays
NULL until "a later settlement pass claims" it (migration 0042, which even
adds the index `idx_refunds_merchant_unbatched` for "the lookup a settlement
pass makes").

CloseBatch never made that lookup. It built the payout from capture events
only:

```go
netPayout := NetPayableFils(batchGross, batchFee)
```

So the payout was captures minus fees, as if the refund never happened. After
the payout, the ledger's `merchant_payable` was left negative by
`amount_fils - fee_reversed_fils` for every refund, and no refund row ever
got a batch.

## How to reproduce

Capture 10,000 fils (fee 250 at 250 bps), refund 4,000 fils with 100 fils of
fee reversed, then close and pay the day. Before the fix the batch paid 9,750
fils, the refund's `settlement_batch_id` stayed NULL, and `merchant_payable`
ended at -3,900.

## Fix

CloseBatch now also locks the merchant's `succeeded` refunds with
`settlement_batch_id IS NULL` and `occurred_at` before the end of the batch's
day (the same window rule as captures, see 020). It takes them oldest first,
sets their `settlement_batch_id` to the batch, and lowers the net payout by
each one's `amount_fils - fee_reversed_fils`. `gross_fils` and `fee_fils`
still describe the captures only. `BatchResult` reports `RefundCount` and
`RefundNetFils`.

**When the refunds are bigger than the batch.** `settlement_batches` has no
check on `net_payout_fils`, but a batch can only send money out:
`PayoutBatch` posts nothing when the net is zero or less. A negative net
would mark the refund as settled while nobody ever collected it. So the net
is never allowed to go below zero. A refund that does not fit in this batch
is left unclaimed (its `settlement_batch_id` stays NULL) and is carried
forward to a later batch that has enough captures to cover it. Smaller
refunds behind it can still be taken. A merchant whose refunds are always
bigger than a whole day's captures keeps a negative `merchant_payable` until
then; collecting that debt any other way is a product decision.

The TS helper `closeAndPayoutBatch` in `apps/api/src/routes/settlement.test.ts`
copies the same refund claiming.

## Test

`apps/settlement/internal/settlement/batch_refunds_test.go`:

- `TestCloseBatch_DeductsRefundsFromPayout`. Before the fix: net 9,750
  instead of 5,850, the refund unclaimed, and `merchant_payable` -3,900 after
  the payout.
- `TestCloseBatch_CarriesForwardARefundTheBatchCannotCover`: a 4,875-fil
  refund is left alone by a 975-fil batch and taken by the next day's batch.
  Before the fix the next day paid 9,750 instead of 4,875 and the refund was
  never claimed.
