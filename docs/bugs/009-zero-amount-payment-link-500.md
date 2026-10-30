# 009: Creating a payment link for 0 fils returns a 500

**Severity:** Low. A merchant mistake got a server error.

## Where

`apps/api/src/paymentLinks/create.ts`, `createPaymentLink`, behind
`POST /v1/merchants/:merchantId/payment-links`.

## Why it was wrong

The function's comment promises "every validation failure is a real
`AppError` subclass, never ... a `500`", but it only wrapped `toFils()`,
which accepts 0. A zero amount then reached the INSERT and the table's
`CHECK (amount_fils > 0)` failed, which the error handler reports as 500.

## How to reproduce

Create a link with `amountFils: 0`. Before the fix: 500.

## Fix

An amount of 0 or less is refused with `400 invalid_amount` before the
INSERT, the same code used for other bad amounts.

## Test

`apps/api/src/routes/paymentLinks.test.ts`: "a payment link for 0 fils is a
400 invalid_amount, not a 500". Got 500 before the fix.
