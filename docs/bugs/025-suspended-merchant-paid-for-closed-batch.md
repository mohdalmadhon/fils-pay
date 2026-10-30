# 025: A suspended or test-mode merchant still gets paid for an already-closed batch

**Severity:** Low. Money could go out to a merchant who had been suspended
between the batch closing and the payout.

## Where

`apps/settlement/internal/settlement/batch.go`, `CloseBatch` (and
`RunDailyBatch`, which pays whatever CloseBatch returns).

## Why it was wrong

CloseBatch returned an already-closed batch before it checked the merchant:

```go
// Step 4: already closed/paid -> idempotent no-op, nothing to undo.
if status != "open" {
    ...
    return BatchResult{ ... AlreadyClosed: true ... }, nil
}

// Step 5: merchant must be active and not in test mode.
```

`RunDailyBatch` then called `PayoutBatch` on that batch. So a batch closed
while the merchant was active, but not yet paid (for example the payout step
failed, see 021), was paid on the next run even after support had suspended
the merchant or put it in test mode. The merchant list in `RunDailyBatch`
filters ineligible merchants, but `--merchant=<id>` and the internal API's
`merchantId` skip that list.

## How to reproduce

Close a batch for an active merchant, set the merchant to `suspended`, then
run `settlement run-batch --date=<that day> --merchant=<id>`. Before the fix
the batch became `paid` and the payout ledger legs were posted.

## Fix

The eligibility check now runs before the already-closed shortcut. For an
ineligible merchant CloseBatch returns `ErrMerchantNotEligible` whatever the
batch's state, and `RunDailyBatch` skips the merchant without paying. The
batch stays `closed` and is paid on a later run if the merchant becomes
active again.

## Test

`apps/settlement/internal/settlement/batch_eligibility_test.go`:
`TestRunDailyBatch_DoesNotPayAClosedBatchOfAnIneligibleMerchant` (suspended
and test-mode cases). Before the fix CloseBatch returned no error, the batch
was marked paid and 2 payout ledger legs were posted.
