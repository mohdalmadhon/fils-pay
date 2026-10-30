# 072: Overview says "in the last N days" using the number of days with data

**Severity:** Low. A merchant with captures on only a few days read
"Captured in the last 3 days" for a 30-day total, and thought the number
covered three days.

## Where

`apps/web/src/pages/overview/OverviewPage.tsx`: the hero label and the
chart's screen-reader label.

## Why it was wrong

```tsx
Captured {volumes ? `in the last ${volumes.points.length} ${...}` : "so far"}
label={`Captured volume over ${volumes.points.length} days, ...`}
```

`volumes.points` has one entry per day that had captures, not one per day
in the window. The window is set by the From and To fields, or by the
server's default (30 days before today through today, Bahrain dates).

## How to reproduce

A merchant with captures on 3 of the last 30 days opens Overview with the
date fields blank. The hero says "Captured in the last 3 days" above the
30-day total.

## Fix

A helper, `windowLabel` in `apps/web/src/pages/overview/windowLabel.ts`,
describes the requested window with the API's rules: blank fields are "in
the last 30 days and today"; with dates it says "from X to Y" (the day
before the exclusive To), "on X" or "since X". Both labels use it.

## Test

`apps/web/src/pages/overview/windowLabel.test.ts`: "the label names the
requested window, not the number of days with data". Before the fix the
label depended only on how many days had rows.
