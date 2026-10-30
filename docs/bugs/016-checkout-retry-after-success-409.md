# 016: A buyer's retry of a successful checkout (same Idempotency-Key) gets 409 instead of the original 200

**Severity:** Low. A buyer whose payment went through, but whose browser
lost the response, was told the link was "already paid" instead of being
shown their receipt.

## Where

`apps/api/src/paymentLinks/pay.ts`, `payPaymentLink`, when the reserve step
matches no row.

## Why it was wrong

The Idempotency-Key on `POST /v1/payment-links/:token/pay` exists so a
retry gets the same answer. But once the link is `paid`, the reserve UPDATE
matches nothing and `classifyClaimFailure` answers
`409 payment_link_already_paid` before any of the idempotent steps (whose
saved responses would replay) runs. So the buyer's own retry got 409.

## How to reproduce

Pay a link with key K (200), then send the same request with key K again.
Before the fix: `409 payment_link_already_paid`.

## Fix

When the reserve step fails, `replayPaidAttempt` checks three things:

- the link is `paid`;
- an authorize idempotency record exists under this attempt's key
  (`paylink:<linkId>:<key>:authorize`);
- the transaction saved in that record is the one the link was paid with.

If all three hold, it returns the original 200 body. A different key is
still refused with 409, so a second buyer can't pay again.

## Test

`apps/api/src/routes/paymentLinks.test.ts`: "retrying a successful payment
with the same Idempotency-Key replays the 200". Got 409 before the fix.
