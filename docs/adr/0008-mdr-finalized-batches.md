# 0008. MDR recalculation preserves finalized batches

- **Status:** Accepted
- **Date:** 2026-10-29
- **Related:** [MDR investigation and reference trail](../solved-problems/004-mdr-finalized-batches.md)

## Context

`RecalculateMDR` excluded open batches, overwrote closed and paid batch
totals using current merchant terms, posted the fee difference against the
old batch, and moved the cached balance. This contradicted the operators'
understanding that finalized figures were preserved, and could disconnect
the recorded parent net from an already-executed payout or child allocation.

## Decision

Recalculation selects and updates only existing `open` batches. `closed`
and `paid` batch figures are immutable to this operation. It does not reopen
them or post historical corrections.

An open batch has not yet claimed its capture events. Recalculation therefore
refreshes its provisional gross, fee, and net totals from unbatched capture
and partial-capture events in the same business-day window that `CloseBatch`
uses. It applies the same effective-dated fee schedules, merchant fallback
rate, negotiated discount, platform tier, and per-event fee calculation.
Those existing rules are unchanged.

Previewing totals does not claim events, post ledger entries, move cached
balances, increment platform volume, or create exports, splits, or payouts.
The batch row lock serializes it with closing; the update also requires
`status = 'open'`. `CloseBatch` computes and freezes final totals normally.

## Consequences

- Historical-only requests consider zero batches and make no financial
  changes. API response field names remain unchanged; `adjusted` now lists
  provisional open-batch updates, and `diffFils` is not a ledger posting.
- Preview results can change as captures, effective rates, discounts, or
  platform volume change before closing. A preview is not a payout promise.
- Approved historical corrections require a separate explicit adjustment
  process. This change does not implement one or repair previous rewrites.
- Existing tests asserting finalized-batch recalculation remain unchanged
  and conflict with the corrected behavior; verification records this
  rather than reporting a green suite.
