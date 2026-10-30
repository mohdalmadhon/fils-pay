# 011: A tampered page cursor on the transactions, payment-links or settlement lists returns a 500

**Severity:** Low. A hand-edited or corrupted `?cursor=` got a server error.

## Where

`decodeCursor` in:

- `apps/api/src/transactions/query.ts` (`GET /v1/transactions`)
- `apps/api/src/paymentLinks/query.ts` (the merchant's payment-link list)
- `apps/api/src/settlement/query.ts` (`GET /v1/settlement/batches`)

## Why it was wrong

The cursor is base64url of `"<timestamp or date>|<id>"`. The decoder only
checked that both halves were non-empty, and the comment says a malformed
cursor "restarts from the first page instead of erroring". The halves then
went into SQL as `$n::timestamptz`, `::date` and `::uuid`, so
`base64url("x|y")` failed the cast and came back as 500.

## How to reproduce

`GET /v1/transactions?cursor=eHx5` (that is `x|y`). Before the fix: 500.

## Fix

The decoders now check both halves:

- The timestamp (as Postgres prints it) or the date must be a real calendar
  value. The checks are in a new `apps/api/src/lib/cursorParts.ts`, because
  `Date.parse` accepts `2026-02-30` and rolls it over.
- The id must be a canonical UUID.

If either check fails, the cursor is ignored and the first page is
returned, as the comments always said. The admin lists and the
webhook-deliveries list have the same problem; they are fixed separately.

## Test

- `apps/api/src/lib/cursorParts.test.ts` (pure).
- `apps/api/src/routes/transactions.test.ts`: "a tampered list cursor
  restarts from the first page instead of a 500". Got 500 before the fix.
