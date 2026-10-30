# 048: Analytics accepted dates like 2026-02-30 and then crashed with a 500

**Severity:** Low. A dashboard link with a day that doesn't exist gave a
server error instead of "invalid date".

## Where

`apps/api/src/routes/analytics.ts`, `isValidDateString` (used by
`parseDateRange` for `/v1/analytics/volumes`, `payout-trends` and `top-links`).

## Why it was wrong

```ts
/** Strict YYYY-MM-DD that also round-trips through Date (rejects 2026-02-30). */
function isValidDateString(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}
```

The comment is wrong. `Date.parse("2026-02-30")` returns a number (JavaScript
quietly rolls it over to 2 March), so the check passed. Postgres then refused
`'2026-02-30'::date`, and the request ended as 500.

## How to reproduce

`GET /v1/analytics/volumes?from=2026-02-30&to=2026-03-05` with a merchant API
key. Before the fix: 500.

## Fix

A new `isIsoCalendarDate` in `apps/api/src/lib/calendarDate.ts` builds the
date and checks it prints back as the same `YYYY-MM-DD` (the same check
`creditRequestValidation.isRealCalendarDate` uses). `isValidDateString` now
calls it, so impossible days are `400 invalid_date`.

## Test

`apps/api/src/routes/analytics.test.ts`: "analytics: a date that doesn't
exist (2026-02-30) is a 400 on every endpoint, not a 500". It got 500 before
the fix.
