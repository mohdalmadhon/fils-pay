# 004: When checkout's capture fails, the buyer's authorization is left open

**Severity:** Medium. The buyer's funds stay held for 7 days although they
were not charged, and each retry adds another hold.

## Where

`apps/api/src/paymentLinks/pay.ts`, `payPaymentLink`, the `capture_failed`
outcome and errors thrown by the capture-and-finalize transaction.

## Why it was wrong

Checkout authorizes, then captures. When capture was declined or the
acquirer failed, the link was put back to `active`, but the transaction
stayed `authorized` with an `active` hold (`expires_at` = 7 days). The
checkout page sends a fresh idempotency key on every click, so every retry
created one more open authorization on the buyer's card. The neighbouring
`lost` outcome (another attempt took the link) already voided for exactly
this reason; the capture-failure path did not.

## How to reproduce

Use an acquirer whose capture declines. Pay: `402 { stage: "capture" }`, and
the transaction is `authorized` with an active hold.

## Fix

A shared `voidAuthorization` helper voids the uncaptured authorization in
three cases: `lost`, `capture_failed`, and an error thrown inside the capture
transaction (which rolled back, so nothing was captured). It is best effort:
a void failure is logged, and the hold still expires on its own.

## Test

`apps/api/src/paymentLinks/payFailures.test.ts`: "a failed capture voids the
authorization it leaves behind". Failed with `actual: 'authorized'` before
the fix.
