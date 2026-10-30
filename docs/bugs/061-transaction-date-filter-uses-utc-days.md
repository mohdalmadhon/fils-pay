# 061: Transaction date filters use UTC days, not Bahrain business days

**Severity:** Medium. Filtering transactions by day left out the first three
hours of the day (00:00 to 03:00 Bahrain time) and pulled in the last three
hours of the day before, so totals did not match settlement.

## Where

`apps/web/src/format.ts`, `dayStartIso`, used by the From and To filters in
`apps/web/src/pages/transactions/TransactionListPage.tsx`.

## Why it was wrong

FilsPay's business day is Asia/Bahrain (UTC+3). The helper turned the
picked date into midnight UTC:

```ts
return dateValue ? `${dateValue}T00:00:00.000Z` : undefined;
```

Midnight UTC is 03:00 in Bahrain. A comment above it even said "fixed, uses
bahrain time now", but the code did not, and the existing unit test pinned
the UTC value.

## How to reproduce

A payment at 01:30 Bahrain time on 12 September (22:30 UTC on 11
September). Filter From 12 September, To 13 September. Before the fix the
request was `from=2026-09-12T00:00:00.000Z`, so the payment was missing,
while a payment at 01:30 Bahrain time on 13 September was included.

## Fix

`dayStartIso` now returns Bahrain midnight as a UTC instant:
`2026-09-12` becomes `2026-09-11T21:00:00.000Z`. The To field is already
labelled "To (exclusive)" and sends the start of that day, which matches the
API's `occurred_at < to`, so there is no separate day-end helper to change.

## Test

`apps/web/src/dashboard.test.ts`: "dayStartIso converts a date input to the
start of that Bahrain business day". Before the fix it got
`2026-09-12T00:00:00.000Z`.
