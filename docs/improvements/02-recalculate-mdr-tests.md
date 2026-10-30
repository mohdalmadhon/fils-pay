# 02: Four Go settlement tests asserted a behaviour that ADR 0008 replaced

| | |
|---|---|
| **Type** | Out-of-date tests (the code follows the accepted ADR) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `go test ./...` in `apps/settlement`: `TestRecalculateMDR_RecomputesAtCurrentRate`, `…AdjustmentLedgerGroupBalances`, `…UnchangedRateAdjustsNothing`, `…OutOfRangeBatchUntouched` in `internal/settlement/recalculate_mdr_test.go`, all failing with `BatchesConsidered = 0` |

## What was wrong

[ADR 0008](../adr/0008-mdr-finalized-batches.md) (accepted 2026-10-29, from
[solved problem 004](../solved-problems/004-mdr-finalized-batches.md)) changed
`RecalculateMDR` so that it:

- recalculates **open** batches only, as a provisional preview;
- never rewrites **closed** or **paid** batches;
- posts **no** ledger adjustment.

The four tests still built a *closed* batch, changed the rate, and expected it
to be rewritten with an `MDR recalculation adjustment` ledger group. With the
new code nothing is selected, so all four failed. The ADR itself said these
tests "remain unchanged and conflict with the corrected behavior".

The code was right and the tests were stale, so the tests were replaced, not
the code.

## Fix

The tests now describe the ADR:

| Test | Checks |
|---|---|
| `RefreshesOpenBatchAtCurrentRate` | An open batch with three captures is recomputed per event at the new rate; gross, fee and net are updated; status stays open; no ledger legs. |
| `LeavesClosedAndPaidBatchesAlone` | A closed and a paid batch in range: 0 considered, fees unchanged, no ledger legs. |
| `UnchangedRateAdjustsNothing` | Open batch already at the right totals: considered, not adjusted. |
| `OutOfRangeBatchUntouched` | Only the open batch inside `[from, to)` is updated. |

Expected fees read the platform volume tier the same way the code does, so
the tests don't depend on how much volume the shared test database has.

## Commits

| # | Commit |
|---|---|
| 1 | `test(settlement): RecalculateMDR refreshes an open batch at the current rate` |
| 2 | `test(settlement): RecalculateMDR never touches closed or paid batches` |
| 3 | `test(settlement): unchanged rate is a no-op; out-of-range open batch untouched` |
| 4 | `docs: ADR 0008 no longer lists the stale tests as an open conflict` |
| 5 | `docs: improvement 02, RecalculateMDR tests` |

No Go application code changed.

## Verified

`go test ./internal/settlement/ -run RecalculateMDR`: 4/4 pass.
