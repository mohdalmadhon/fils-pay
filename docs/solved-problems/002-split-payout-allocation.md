# 002 — Split payouts do not conserve the parent total

Recorded: 2026-10-29.

Status: implemented locally and verified against the isolated local database.
Deployment and historical payout corrections have not been performed.

## Reported problem and scope

Delta Marketplace's three child payouts reportedly total less than the
parent payout, by tens of fils per batch. Investigation found independent
rounding without remainder allocation and missing runtime validation of the
combined split weights.

These are confirmed code defects. They do not establish the complete cause
of the reported production amounts: with exactly three children and weights
totaling 100%, independent nearest-fil rounding can differ from the parent
by at most one fil. Tens of fils per batch require checking actual weights,
the original payout amounts, and any later batch adjustments.

The seed configures Delta's children at 50%, 30%, and 20%; production weights
and historical child payout rows have not been inspected.

## Root cause and where the remainder stayed

`PayoutSplitBatch` previously called `money.ApplyRateFils` separately for
each child. The standalone `ChildShares` helper did the same, and production
duplicated that calculation instead of sharing the helper's implementation.
Each call rounded independently to the nearest fil, with ties to even.

For a 101-fils parent payout at 50% / 30% / 20%:

| Child | Exact entitlement | Previous payout | Fixed payout |
|---|---:|---:|---:|
| A | 50.5 fils | 50 fils | 51 fils |
| B | 30.3 fils | 30 fils | 30 fils |
| C | 20.2 fils | 20 fils | 20 fils |
| Total | 101 fils | 100 fils | 101 fils |

The old payout posted ledger legs for only 100 fils, deducted only 100 fils
from the parent cache, and still marked the batch paid. Relative to the
opening liability, the unallocated fil remained payable to the parent; no
separate remainder ledger entry identified it. Other inputs could produce
an over-allocation instead. Balanced debit/credit legs alone do not ensure
that the child payouts conserve the batch total.

The database only checks each configured weight separately. It does not
require their sum to equal 10,000 bps. Seed validation did not protect a
configuration subsequently changed elsewhere.

## Solution

Both allocation entry points now share one checked implementation:

1. Reject negative payouts, missing children, weights outside 1–10,000 bps,
   and weights whose total is not exactly 10,000 bps. Do not normalize an
   invalid configuration silently.
2. Calculate each child's proportional share rounded down to whole fils.
3. Give the remaining whole fils to the children with the largest
   fractional remainders. Break ties by input order; the database caller
   orders children by UUID, making the result deterministic.
4. Record every child's allocation, including zero shares. Only positive
   shares produce ledger legs.
5. Require the total allocated to equal the parent batch net payout before
   deducting the parent cache and marking the batch paid. All writes remain
   in the payout's transaction, so an error rolls them back.

The calculation divides the total before multiplying by each weight, avoiding
an intermediate `int64` overflow even for a `MaxInt64` payout. It uses only
integer arithmetic and preserves the frozen money packages unchanged.

The database payout calls the checked implementation directly and returns
validation errors. After integration with main, the public `ChildShares`
helper retains main's proportional-weight and nonpositive-total compatibility
behavior; that helper does not decide whether a database payout is valid.
See [the merge decisions](013-finance-main-merge.md). No frozen money code
or locked test was changed during integration.

## Affected code

Line numbers are those at the time of this fix; function names are stable
references if files move.

| File and location | Change |
|---|---|
| [shares.go:15](../../apps/settlement/internal/splits/shares.go#L15), `ChildShares` | Replace independent rate rounding with the common allocator while retaining the existing function signature |
| [shares.go:27](../../apps/settlement/internal/splits/shares.go#L27), `allocateChildShares`, lines 27–69 | Validate payout and weights; implement exact largest-remainder allocation with stable tie-breaking and overflow-safe arithmetic |
| [allocate.go:84](../../apps/settlement/internal/splits/allocate.go#L84), child query in `PayoutSplitBatch` | Lock selected configuration rows for sharing during payout and retain UUID ordering |
| [allocate.go:111](../../apps/settlement/internal/splits/allocate.go#L111), allocation before posting | Use the common checked allocator and return contextual errors before writes |
| [allocate.go:125](../../apps/settlement/internal/splits/allocate.go#L125), posting loop and total check | Persist zero-share audit rows, post positive ledger amounts, and enforce equality with the batch net payout before completion |

The existing batch row lock and already-paid guard continue to protect
against duplicate payouts. Existing paid batches are not recalculated.
Regression test files, database migrations, and frozen money code were not
modified.

## Validation

A temporary Go verification harness exercised the actual allocation helper
and `PayoutSplitBatch`; it was removed from the working tree afterward to
leave regression-locked test files unchanged.

- 50,020 allocations across five weight configurations preserved the exact
  total, stayed within the integer floor/ceiling of each entitlement, and
  returned deterministic results. Included totals 0–10,000 and values up to
  `MaxInt64`.
- Explicit checks covered the 101-fils example and equal-remainder ties.
- PostgreSQL checks covered normal, one-fil, and zero payouts. Persisted
  child totals, parent cache deductions, and payable ledger movements agreed
  exactly; every child had an audit row, and zero payouts had no ledger legs.
- Underweight, overweight, empty-child, and negative-payout cases returned
  errors without changing batch status, cache, split rows, or payout legs.
- Each database case included two concurrent payout attempts. Valid batches
  were paid once; the other attempt observed `AlreadyPaid`.

The full `go test ./...` run against the local database passed the splits
and settlement packages. It failed in the ledger and internal API packages
because the `merchant_payable_position` view is missing. The full `npm test`
run against that database also failed with missing schema, including
`live_sessions` and tables from later migrations. The existing migration
failure at `0054_views.sql` prevents the local database from being fully
migrated. These full-suite failures remain unresolved; the focused checks
above do not imply a passing full backend suite.

## Historical investigation

This read-only query compares a parent's current stored batch net with its
recorded child allocations. Replace the UUID placeholder before running:

```sql
SELECT b.id AS batch_id,
       b.batch_date,
       b.net_payout_fils,
       COALESCE(s.child_total_fils, 0) AS child_total_fils,
       b.net_payout_fils - COALESCE(s.child_total_fils, 0) AS difference_fils,
       s.recorded_weight_bps,
       s.recorded_children
  FROM settlement_batches b
  LEFT JOIN (
    SELECT settlement_batch_id,
           SUM(allocated_fils) AS child_total_fils,
           SUM(split_weight_bps) AS recorded_weight_bps,
           COUNT(*) AS recorded_children
      FROM settlement_batch_splits
     GROUP BY settlement_batch_id
  ) s ON s.settlement_batch_id = b.id
 WHERE b.merchant_id = '<parent-merchant-uuid>'::uuid
   AND b.status = 'paid'
 ORDER BY b.batch_date;
```

Interpret this alongside payout ledger entries and original records:

- Current configuration is in `merchant_split_children`; historical weights
  are captured in the split rows. Before this fix, zero-share children were
  omitted, so missing rows or a low recorded weight sum are not conclusive
  proof of invalid original configuration.
- A parent batch's net may have been changed after payout by
  `RecalculateMDR`; the current net is not necessarily the original payout
  target. Delta's saved finance notes mention such a recalculation.
- Changing a paid batch back to closed to retry would risk paying its
  children again. Historical corrections need a separately reviewed posting
  based on the actual ledger and payout history.
- This fix does not resolve unrelated cache rebuild behavior, fee
  recalculation, or float arithmetic in the parent net calculation.
