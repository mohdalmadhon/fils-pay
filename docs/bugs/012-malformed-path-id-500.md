# 012: A malformed id in the URL of transaction, settlement-batch or payment-link routes returns a 500

**Severity:** Low. A wrong link or a typo in an id got a server error.

## Where

- `apps/api/src/routes/transactions.ts`: `GET /:id`, `GET /:id/events`,
  `POST /:id/capture`, `POST /:id/void`.
- `apps/api/src/routes/settlement.ts`: `GET /batches/:id`,
  `GET /batches/:id/transactions`.
- `apps/api/src/routes/paymentLinks.ts`:
  `DELETE /:merchantId/payment-links/:id`.

## Why it was wrong

`request.params.id` went straight into queries like
`WHERE id = $1 AND merchant_id = $2`. The columns are UUIDs, so Postgres
rejects `not-a-uuid` with error 22P02 and the error handler turns that into
a 500. The refund route already checks its id with `canonicalUuid` and the
admin routes return 404.

## How to reproduce

`GET /v1/transactions/not-a-uuid`. Before the fix: 500.

## Fix

Each route turns `:id` into a canonical UUID first (`lib/uuid.ts`).
Anything else cannot name a record, so it gets the same 404 as an unknown
id (`transaction_not_found`, `settlement_batch_not_found`,
`payment_link_not_found`). The acquirer callback route is fixed together
with its other validation gaps (bug 013).

## Test

`apps/api/src/routes/transactions.test.ts`: "a malformed id in the path is a
404, not a 500" (covers all seven routes). Got 500 before the fix.
