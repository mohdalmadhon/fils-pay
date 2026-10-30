# 043: A bad report filter crashed with a 500

**Severity:** Low. A typo in the report filter gave the merchant a server
error instead of telling them what was wrong.

## Where

`apps/api/src/routes/reporting.ts`, `GET /v1/reporting/transactions`, and the
query it feeds, `apps/api/src/reporting/transactionsReportQuery.ts`,
`runTransactionsReport`.

## Why it was wrong

The route only checked that `?filter=` was valid JSON, then read fields off it:

```ts
parsed = JSON.parse(request.query.filter);
...
const merchantId = await resolveReportMerchantId(app.db, ..., parsed.merchantId);
```

`?filter=null` parses to `null`, and `null.merchantId` throws a TypeError.
`{"from":"garbage"}` or `{"to":"2026-02-30"}` was passed straight to
Postgres as a timestamp (`occurred_at >= $2`), and Postgres refused it.
Both ended as `500 internal_error`.

## How to reproduce

With a merchant API key, call
`GET /v1/reporting/transactions?filter=null` or
`?filter={"from":"garbage"}`. Before the fix: 500.

## Fix

A new `parseReportFilter` in the route checks the filter before anything
runs. It must be given once and be a JSON object. `status`, when set, must be
one of the transaction statuses. `from` and `to`, when set, must be an ISO
date or date-time with a real calendar day. Anything else is
`400 invalid_filter`. `null` or `""` for a field still means "not set".

## Test

`apps/api/src/routes/reportingScope.test.ts`: "transactions report: a filter
that isn't a valid object is a 400, not a 500". Before the fix the first
case (`null`) got 500.
