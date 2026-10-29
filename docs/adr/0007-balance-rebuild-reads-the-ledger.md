# 0007. Every balance rebuild reads the ledger

- **Status:** Accepted
- **Date:** 2026-10-29
- **Supersedes:** 0004
- **Related:** FP-203, docs/fixes/balance-cache-rebuild-source.md

## Context

ADR 0004 had the console's **Rebuild cached balances** button rebuild from a
"faster query path using settled data" (the `merchant_payable_position` view,
which sums `scheme_export_lines.amount_fils`), while the CLI kept the ledger
walk. It assumed the two "agree whenever the cache is consistent with settled
activity".

They never agree for a real merchant. The view counts only the gross of
batched captures. It ignores MDR fees, payouts, credits, imports, refunds and
every capture not yet batched. One merchant's balance went from 135,000 BD to
7,000 BD after the button was pressed, while the CLI still printed the right
figure. The handover already warned against this ("There is no console
button, and there shouldn't be one that reads anything else").

## Decision

1. `merchant_balances` is rebuilt from `ledger_entries` only, by one
   function: `ledger.RebuildAllBalances`. The CLI and
   `POST /internal/rebuild-balances` both call it.
2. `ledger.RefreshBalanceCache` and its tests are removed. Nothing reads
   `merchant_payable_position` any more.
3. The rebuild is a single aggregate pass over the ledger, not two queries per
   merchant, and it locks `merchant_balances` before reading the ledger so a
   concurrent batch close or payout cannot be lost.

## Consequences

- The button and the CLI always print the same figure.
- Cache-only **Adjust balance** corrections (ADR 0006) are still reset by a
  rebuild. That is now correct behaviour: the rebuilt value is the ledger
  balance, which those corrections were papering over.
- If a full rebuild ever takes longer than the API's
  `SETTLEMENT_INTERNAL_REQUEST_TIMEOUT_MS` (30 s by default), raise the timeout
  or run the CLI. Never switch to a different data source.
