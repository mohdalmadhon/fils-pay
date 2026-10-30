# 021: One merchant's error stops the daily settlement run for everyone after it

**Severity:** High. A single bad merchant left every later merchant unpaid
for the day, and no payout notifications went out at all.

## Where

`apps/settlement/internal/settlement/batch.go`, `RunDailyBatch`.
`apps/settlement/internal/scheduler/daemon.go`, `runIfDue`.
`apps/settlement/cmd/settlement/main.go`, the `run-batch` subcommand.

## Why it was wrong

`RunDailyBatch` goes through the merchants one at a time and returned on the
first error:

```go
closeResult, err := CloseBatch(ctx, db, merchantID, businessDate)
if err != nil {
    ...
    return report, fmt.Errorf("settlement: RunDailyBatch: CloseBatch(%s): %w", merchantID, err)
}
```

The same happened for `IsSplitParent`, `PayoutSplitBatch` and `PayoutBatch`.
Then the daemon returned before the payout notification scan:

```go
report, err := settlement.RunDailyBatch(ctx, db, businessDate, nil)
if err != nil {
    log.Printf(...)
    return
}
...
enqueued, err := settlement.EnqueuePayoutNotifications(ctx, db)
```

The `run-batch` CLI did the same with `log.Fatalf`. So while one merchant
kept failing (bad data, a lock timeout, a split misconfiguration), every
merchant sorted after it was not paid, and merchants that were paid by an
earlier pass or by the split path got no `settlement.paid` notification.

## How to reproduce

Make one merchant's close fail (for example a trigger that raises on its
`settlement_batches` insert) and give a merchant with a larger id a capture
on the day. Run the batch for that day. Before the fix the error came back
at once, the second merchant had no batch, and the notification scan never
ran.

## Fix

- `RunDailyBatch` handles each merchant in `runOneMerchant`. A failure is
  logged, stored in that merchant's `MerchantBatchOutcome.Error`, and the
  loop moves on. At the end, if any merchant failed, it returns the full
  report plus an error that wraps `ErrMerchantsFailed`. Each merchant's close
  and payout are their own transactions, so nothing is left half-done, and a
  re-run is safe.
- The daemon's pass (`runPass`) always runs `EnqueuePayoutNotifications`
  after `RunDailyBatch`, whether or not some merchants failed.
- `run-batch` prints every outcome (with `FAILED:` lines), runs the
  notification scan, and only then exits non-zero if any merchant failed.
- The internal API still answers 500 when any merchant failed, so the admin
  console still shows that something went wrong.

## Test

- `apps/settlement/internal/settlement/batch_merchant_failure_test.go`:
  `TestRunDailyBatch_ContinuesPastAFailingMerchant`. Against the old code the
  call returned the injected error straight away and the report had neither
  merchant in it.
- `apps/settlement/internal/scheduler/run_pass_test.go`:
  `TestRunPass_EnqueuesNotificationsEvenWhenAMerchantFails`: a paid,
  not-yet-announced batch gets its `settlement.paid` event even though
  another merchant's close fails in the same pass.
