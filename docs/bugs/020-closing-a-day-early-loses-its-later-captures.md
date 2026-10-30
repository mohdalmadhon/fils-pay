# 020: Closing a business day early loses that day's later captures

**Severity:** High. A day closed before it ended never paid the merchant for
the captures that came after the close.

## Where

`apps/settlement/internal/settlement/batch.go`, `CloseBatch` and
`RunDailyBatch`. Reached from the `settlement run-batch --date=...` CLI, the
internal API `POST /internal/run-batch`
(`apps/settlement/internal/internalapi/server.go`, `handleRunBatch`) and the
admin route `POST /v1/admin/settlement/run-batch`
(`apps/api/src/routes/admin.ts`).

## Why it was wrong

Nothing stopped anyone from closing today's date, or a future one. CloseBatch
only looked at captures inside that one day:

```sql
AND te.settlement_batch_id IS NULL
AND te.occurred_at >= $2 AND te.occurred_at < $3
```

and a batch that is already closed is a no-op:

```go
// Step 4: already closed/paid -> idempotent no-op, nothing to undo.
if status != "open" {
```

So if an operator ran the batch for today at 14:00, every capture from 14:00
to midnight stayed unbatched. Running the day again did nothing (already
closed), and the next day's batch ignored them (wrong day). They were never
paid out. The same thing happened, more rarely, to a capture whose
transaction committed just after its day's batch had closed.

## How to reproduce

Run `settlement run-batch --date=<today>` for a merchant, then capture a
payment for that merchant. Run the batch for today again, and later for
tomorrow. The capture's `transaction_events.settlement_batch_id` stays NULL
for good.

## Fix

- `CloseBatch` and `RunDailyBatch` refuse a date that is today or later in
  Asia/Bahrain (`CheckBusinessDayOver`, error `ErrBusinessDayNotOver`). The
  CLI exits with that message. The internal API returns
  `400 business_day_not_over` before it reaches the database, and the admin
  route returns the same 400 before it writes an audit row or calls
  settlement.
- `CloseBatch` now takes every unbatched capture with `occurred_at` before
  the end of its day, with no lower bound. A capture from an earlier day that
  no batch has claimed lands in the next batch that closes.
  `settlement_batch_id IS NULL` still stops a capture being claimed twice.
- The TS test helper `closeAndPayoutBatch` in
  `apps/api/src/routes/settlement.test.ts`, which copies CloseBatch's SQL,
  uses the same selection.

## Test

- `apps/settlement/internal/settlement/batch_test.go`:
  `TestCloseBatch_SweepsLateCaptureIntoNextBatch` (before: the next day's
  batch had gross 0 and the capture stayed unbatched) and
  `TestCloseBatch_RejectsTodayAndFutureBusinessDates` (before: both calls
  returned no error and created batch rows). `TestCloseBatch_EligibleEventSelection`
  now expects the earlier unbatched capture to be included.
- `apps/settlement/internal/internalapi/server_test.go`:
  `TestRunBatch_RejectsTodayAndFutureDates`.
- `apps/api/src/routes/admin.test.ts`: "settlement run-batch refuses today's
  or a future business day before auditing or calling settlement" (before:
  status 200).
