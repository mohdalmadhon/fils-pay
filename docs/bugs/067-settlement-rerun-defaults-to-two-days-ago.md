# 067: Settlement re-run date defaults to two days ago after midnight

**Severity:** Low. Between 00:00 and 03:00 Bahrain time the settlement
page pre-filled the day before yesterday, so an operator who did not check
the date could re-run the wrong day's batch.

## Where

`apps/admin/src/pages/settlement/SettlementPage.tsx`, `yesterdayIso` (the
default value of the batch date field).

## Why it was wrong

It subtracted a day in the browser's local time, then printed the date in
UTC:

```ts
const date = new Date();
date.setDate(date.getDate() - 1);
return date.toISOString().slice(0, 10);
```

At 01:30 Bahrain time on 12 September the local "yesterday" is 01:30 on 11
September, which is 22:30 UTC on 10 September, so the field showed
`2026-09-10`.

## How to reproduce

With the browser in Asia/Bahrain, open the settlement page at 01:30 on 12
September. The date field shows 10 September instead of 11 September.

## Fix

A small helper, `apps/admin/src/bahrainDate.ts`. `bahrainYesterday` adds
three hours to the current instant, takes one day off, and reads the UTC
calendar date. That gives Bahrain's yesterday in any browser time zone. The
page uses it for the default.

## Test

`apps/admin/src/bahrainDate.test.ts`: "yesterday is the Bahrain day before
today, even between 00:00 and 03:00 Bahrain time". The old code gave
`2026-09-10` for 22:30 UTC on 11 September; the test expects `2026-09-11`.
