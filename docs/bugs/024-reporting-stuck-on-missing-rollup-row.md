# 024: Reporting gets stuck when a day has no rollup row

**Severity:** Medium. One batch-closed event for a day with no rollup row
stopped the reporting worker for good, so every dashboard stopped updating.

## Where

`apps/reporting/src/consumer/applyEvent.ts`, `applyBatchClosed` (the rollup
parity check at the end).

## Why it was wrong

When a batch closes, the worker compares that day's capture count in
`transaction_events` with its own `merchant_daily_volume` row. It assumed the
row was always there:

```ts
const rollup = rollupResult.rows[0] as { captured_count: number };
if (rollup.captured_count < groundTruthCount) {
```

If the day had captures but none of their `transaction.captured` events had
reached the rollup (exactly the lag this check exists to catch), there was no
row, `rows[0]` was `undefined`, and reading `captured_count` threw a
`TypeError`. `runConsumerPass` applies all events in one transaction, so the
whole pass rolled back. The next pass picked up the same event first and
threw again, forever.

## How to reproduce

Insert a capture event on 2026-01-05 for a merchant with no
`merchant_daily_volume` row for that day, then apply a
`settlement.batch_closed` event for that merchant and date. Before the fix:
`TypeError: Cannot read properties of undefined (reading 'captured_count')`.

## Fix

A missing row counts as a rollup of 0
(`Number(rollupResult.rows[0]?.captured_count ?? 0)`). That is lower than the
ground truth, so the existing warning is logged, with a note that the row is
missing, and the event is applied normally.

## Test

`apps/reporting/src/consumer/applyEvent.test.ts`: "applyBatchClosed (via
applyEvent): a day with captures but no rollup row warns instead of
throwing". Before the fix it failed with the `TypeError` above.
