# 006: Capturing the rest of a payment after a refund marks it 'captured' and forgets the refund

**Severity:** Low. The status disagreed with the money columns, so a
partly refunded payment looked untouched in filters, the CSV export and the
`transaction.captured` webhook.

## Where

`apps/api/src/payments/capture.ts`, `captureTransactionWithClient`, where
the new status is worked out.

## Why it was wrong

```ts
const newStatus = compareFils(newCapturedFils, amountAuthorized) === 0 ? "captured" : "partially_captured";
```

This ignores `refunded_fils`. `refundState.ts` keeps a refunded partial
capture as `partially_captured` on purpose (the rest of the authorization
can still be captured). Capturing that rest then set `captured`, although
4,000 of the 10,000 had been refunded. `refundState.ts` itself says the
status is derived from the money "to keep the status and the amounts from
ever disagreeing".

## How to reproduce

Authorize 10,000, capture 4,000, refund it all, capture the remaining 6,000.
Before the fix: `status: captured, captured_fils: 10000, refunded_fils: 4000`.

## Fix

The locked read also fetches `refunded_fils`, and the status comes from
`nextStatusAfterRefund`, the same rule refunds use (here
`partially_refunded`). Releasing the hold and choosing the
`captured`/`partially_captured` event type still depend only on whether the
whole authorization is now captured, so those are unchanged.

## Test

`apps/api/src/routes/merchantRefunds.test.ts`: "capturing the rest after a
refund keeps the status in line with the refunded amount" (also checks the
hold is released and the events). Got `'captured'` before the fix.
