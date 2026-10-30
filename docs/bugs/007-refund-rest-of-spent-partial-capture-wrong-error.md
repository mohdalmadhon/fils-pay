# 007: Refunding "the rest" of a fully refunded partial capture answers "bad amount" instead of "not refundable"

**Severity:** Low. The merchant was told their request was malformed when
the real answer is "there is nothing left to refund".

## Where

`apps/api/src/payments/refundValidation.ts`, `validateRefundRequest`.

## Why it was wrong

A partial capture whose captured part has been fully refunded keeps the
status `partially_captured` on purpose (`refundState.ts`: the rest of the
authorization can still be captured). So it passes the status check. With
no amount in the request ("refund the rest"), the default amount is the
refundable amount, 0, and the next check rejects it:

```ts
const requested = requestedAmountFils ?? refundable;   // 0
if (compareFils(requested, ZERO_FILS) <= 0) return { code: "refund_amount_invalid" }; // 422
```

The caller sent no amount, yet was told the amount was invalid. A fully
`refunded` transaction gets `409 transaction_not_refundable`.

## How to reproduce

Capture 4,000 of 10,000, refund it, then refund again with no amount.
Before the fix: `422 { code: "refund_amount_invalid" }`.

## Fix

With no amount and nothing refundable, the answer is
`transaction_not_refundable` (409). With an explicit amount the answer stays
`refund_exceeds_refundable` with `refundableFils: 0`, which an existing test
pins and which tells the caller the ceiling.

## Test

`apps/api/src/payments/refundValidation.test.ts`: "refunding 'the rest' of a
partial capture already fully refunded is not refundable (409), not a bad
amount".
