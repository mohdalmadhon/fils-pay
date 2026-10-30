# 008: Malformed amounts or card details on authorize, capture and checkout return a 500

**Severity:** Low. Wrong status code for a client mistake, logged as an
unhandled error; on authorize with amount 0 the acquirer had already
approved before the database refused the row.

## Where

- `apps/api/src/routes/transactions.ts`: `POST /v1/transactions` and
  `POST /v1/transactions/:id/capture`.
- `apps/api/src/routes/paymentLinks.ts`: `POST /v1/payment-links/:token/pay`.

## Why it was wrong

The routes only checked that the fields were present:

```ts
if (amountFils === undefined || !card) throw new BadRequestError(...);
... amountFils: toFils(amountFils), card,
```

- `-1`, `1.5` or `"100"` make `toFils` throw a `RangeError`.
- `0` passes `toFils`, the acquirer approves, then the
  `transactions_amount_fils_check` constraint fails.
- `card: {}` or a numeric `pan` crashes the simulator on `card.pan.endsWith`.

The error handler turns anything that is not an `AppError` into a 500.
The refund route already validated its body; these did not.

## How to reproduce

`POST /v1/transactions` with `amountFils: 0` or `card: {}`, or pay a link
with `{"card": {}}`. Before the fix: 500.

## Fix

A small shared module, `apps/api/src/lib/paymentInput.ts`:

- `parsePositiveFils` accepts only a whole number above 0.
- `parseCardInput` checks the card's shape: number and CVV as strings, a
  month from 1 to 12, a whole year.

All three routes use them, so bad input is a 400 before any business logic
runs. (Bug 003 is the related one: an error during checkout no longer
leaves the link reserved.)

## Test

- `apps/api/src/routes/transactions.test.ts`: "malformed amounts and cards
  are a 400, not a 500".
- `apps/api/src/routes/paymentLinks.test.ts`: "paying with a malformed card
  is a 400 and leaves the link payable".

Both got 500 before the fix.
