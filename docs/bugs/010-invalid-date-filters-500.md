# 010: Invalid or impossible dates in transaction and settlement filters return a 500

**Severity:** Low. A typo in a date filter got a server error and an
"unhandled error" log line instead of a clear 400.

## Where

- `apps/api/src/routes/transactions.ts`: `GET /v1/transactions` and
  `GET /v1/transactions/export`.
- `apps/api/src/routes/settlement.ts`: `GET /v1/settlement/batches`,
  `/reconciliation` and `/summary`.

## Why it was wrong

The list and export routes did `from: q.from ? new Date(q.from) : undefined`.
`new Date("garbage")` is an Invalid Date, and Postgres rejects it. A
repeated parameter (`?from=a&from=b`) arrives as an array and fails the
same way. The comment on the route says invalid values are rejected with
400.

The reconciliation and summary routes passed the `YYYY-MM-DD` strings on
unchecked:

- `2026-13-01` made `bahrainLocalMidnightUtc` throw a `RangeError`;
- `2026-02-30` is accepted by JavaScript (it rolls over to 2 March) but
  rejected by Postgres.

Both came back as 500.

## How to reproduce

`GET /v1/transactions?from=garbage`, or
`GET /v1/settlement/reconciliation?from=2026-02-30&to=2026-03-01`. Before
the fix: 500.

## Fix

Two helpers next to `parseLimitParam` in `apps/api/src/lib/queryParams.ts`:

- `parseInstantParam` accepts one string that parses to a real date.
- `parseBusinessDateParam` accepts exactly `YYYY-MM-DD`, and only if it
  survives a round trip through a UTC date, so `2026-02-30` is refused.

Anything else is `400 invalid_date`. The analytics routes have the same
problem in their own date check; that one is fixed separately (bug in the
sign-in/admin range).

## Test

- `apps/api/src/routes/transactions.test.ts`: "an invalid date filter on the
  list and export is a 400, not a 500".
- `apps/api/src/routes/settlement.test.ts`: "impossible or malformed dates
  on settlement reports are a 400, not a 500".

Both got 500 before the fix.
