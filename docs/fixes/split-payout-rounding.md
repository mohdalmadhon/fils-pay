# Fix report: settlement splits were always a few fils short

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium (money). Each split payout sent the sub-merchants a few fils less (sometimes more) than the batch's net payout. The difference stayed in the parent's payable balance and built up batch after batch. |
| **Component** | `apps/settlement/internal/splits/shares.go`, `allocate.go`, new `internal/money/allocate.go` |
| **Reported** | "The settlement splits are always a few fils short." |
| **Date** | 2026-10-29 |

## Summary

For a parent merchant with sub-merchant children (`merchant_split_children`),
`PayoutSplitBatch` gave each child
`money.ApplyRateFils(netPayout, child.weightBps)`, a share **rounded on its
own**. Shares rounded separately don't add up to the whole:

| Net payout | Weights | Old shares | Sum |
|---|---|---|---|
| 1000 | 3333 / 3333 / 3334 | 333 / 333 / 333 | **999** |
| 1001 | 3333 / 3333 / 3334 | 334 / 334 / 334 | **1002** |

The ledger debit, the `settlement_batch_splits` rows and the cached balance
all used that short total. The batch was marked `paid` with part of its
net payout never distributed. The code's own comment said *"Shares always
sum to the batch's net_payout_fils"*. It didn't.

The right tool already existed: `packages/money`'s `allocateRemainder`
(largest-remainder method, exact). FH filed FP-250 about exactly this
(*"splits each child with ApplyRateFils, not allocateRemainder"*). It was
closed because "the seed always writes 10000", but the weights summing to
10000 was never the problem.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `money: add AllocateRemainder to the Go money package` | A Go port of the TS function: shares ≥ 0, sum exactly equals the total, leftover fils by largest remainder with ties to the lower index. `big.Int` products, so no overflow. |
| 2 | `splits: allocate a split payout so the shares add up to the net payout` | `ChildShares` and `PayoutSplitBatch` use it. If a parent's weights don't total 10000 (nothing in the database enforces it), they are used as proportions and a warning is logged. Raising an error there would abort the whole daily run. |
| 3 | `db: report split payouts whose shares missed the net payout` | `db/reports/split-payout-shortfall.sql`, read-only. Lists every paid split batch and how far off it was. |
| 4 | `test: split payout shares add up to the net payout` | `money/allocate_test.go` uses the same cases as the TS `allocate_drift_known.test.ts`, so both languages are proven to agree. `splits/split_exact_test.go` includes a database-backed `PayoutSplitBatch`. |
| 5 | `docs: split payout rounding fix report` | This report. |

`packages/money` (frozen) is not modified; the Go port follows it.

## Verification

- New split tests: 4/4 pass. Against the old code, all 4 fail. The DB-backed
  payout of 1000 fils sent out **999**. Weights of 3000/6000 over 900 sent out
  810 and left 90 behind.
- `AllocateRemainder` matches every TypeScript expectation, and sums exactly
  across 1,700 total/weight combinations and a near-`int64` total.
- The existing `TestChildShares_SumToNet` still passes, along with the full Go suite.

## Deploying

Deploy the settlement service. Then run `db/reports/split-payout-shortfall.sql`.
`difference_fils` per batch is what the children are still owed (or were
overpaid). YA's note says no merchant has split children in production yet;
if so, the report comes back empty.

## Related, not changed here

- Nothing stops a parent's weights adding up to something other than 10000. A
  trigger, or a check in whatever admin tool eventually creates these rows,
  would close that gap.
