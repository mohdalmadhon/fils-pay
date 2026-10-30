# 073: The analytics "Data as of" badge shows only a time

**Severity:** Low. When the reporting worker had stopped, the badge said
"Data as of 14:05" for data from days ago, so a merchant believed old
figures were from today.

## Where

`apps/web/src/components/StalenessBadge.tsx`, the lagged-data branch.

## Why it was wrong

```tsx
Data as of {new Date(readModelAsOf).toLocaleTimeString()}
```

`toLocaleTimeString` prints only the clock time. The whole point of the
badge is to show how stale the figures are, and a time without a date
cannot do that once the data is more than a day old.

## How to reproduce

Stop the reporting worker for a day and open Overview. The badge shows
yesterday's time ("Data as of 14:05") with nothing to say it is
yesterday.

## Fix

A helper, `stalenessText` in `apps/web/src/components/stalenessText.ts`,
returns the date and time plus the age, for example "Data as of 29 Oct
2026, 14:05 (1 day ago)". The badge uses it.

## Test

`apps/web/src/components/stalenessText.test.ts`: "the staleness badge
shows the date and how old the data is, not just a time", and "relative
age reads naturally". Before the fix the badge text had no date and no
age.
