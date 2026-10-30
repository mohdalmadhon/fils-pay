# 023: Reconciliation report shows a refund as an unexplained gap

**Severity:** Medium. Any period with a refund that no batch had taken yet
was reported as "not explained", so finance chased gaps that were not real.

## Where

`apps/api/src/settlement/query.ts`, `getReconciliationReport`, behind
`GET /v1/settlement/reconciliation`.

## Why it was wrong

The report checks
`gapFils = ledgerMerchantPayableNetFils - settlementNetPayoutFils - pendingUnbatchedFils`.
The ledger figure includes a refund's legs (`merchant_payable` debited by the
refund, credited by the fee it reversed). But `pendingUnbatchedFils` only
added up unbatched captures:

```sql
SELECT te.amount_fils, te.occurred_at
  FROM transaction_events te ...
 WHERE ... te.event_type IN ('captured', 'partially_captured')
   AND te.settlement_batch_id IS NULL
```

So a refund not yet claimed by a batch showed up as
`gapFils = -(amount_fils - fee_reversed_fils)` and `explained: false`. The
comment above the report even said refunds were "included both in the
ledger figure and in pending", which was not true.

Since fix 022, a batch claims refunds and takes them off its
`net_payout_fils`, so batched refunds already balance. Only the unbatched
ones were left out.

## How to reproduce

Capture 10,000 fils at 250 bps and refund 4,000 of it, then call
`GET /v1/settlement/reconciliation` for today. Before the fix:
`pendingUnbatchedFils: 9750`, `gapFils: -3900`, `explained: false`.

## Fix

The report also sums `amount_fils - fee_reversed_fils` over the merchant's
`succeeded` refunds that have no `settlement_batch_id` and happened inside
the period, and subtracts that from `pendingUnbatchedFils`. The comment now
describes what the code does.

## Test

`apps/api/src/routes/settlement.test.ts`: "GET /v1/settlement/reconciliation
explains an unbatched refund as pending, not as a gap". Before the fix it
failed with `actual: 9750, expected: 5850` on `pendingUnbatchedFils`.
