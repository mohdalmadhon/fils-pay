# 0007. Admin and CLI balance rebuilds use the payable ledger

- **Status:** Accepted
- **Date:** 2026-10-29
- **Supersedes:** [0004](0004-balance-rebuild-source.md)
- **Related:** FP-203; [problem 4 investigation](../solved-problems/003-admin-balance-rebuild-source.md)

## Context

The admin button replaced `merchant_balances.cached_payable_fils` with the
sum of scheme-export amounts. The full CLI rebuild used the merchant's
`merchant_payable` ledger credits minus debits. These are different financial
quantities: export volume does not include all payable movements or deduct
paid-out amounts. The faster source in ADR 0004 could therefore overwrite a
correct balance with an unrelated figure.

## Decision

`RefreshBalanceCache`, used by the admin endpoint, delegates directly to
`RebuildAllBalances`, used by the full CLI rebuild. Both restore the balance
from `ledger_entries` for `account_id = 'merchant_payable'`, with credits
positive and debits negative. The transaction, merchant selection, and
before/after results come from that single implementation.

The existing `merchant_payable_position` view and historical migrations are
unchanged; the admin rebuild no longer uses the view. This decision does
not change cache-only adjustments, incremental balance updates, or the
read-only behavior of the CLI's `--merchant` option.

## Consequences

- With the same ledger state, the admin and full CLI paths produce the same
  rebuilt balances. Separate executions can differ if ledger activity occurs
  between them.
- The admin action inherits the full ledger rebuild's cost. ADR 0004 reported
  about 40 seconds on a cold production dataset; the current default internal
  HTTP timeout is 30 seconds. This fix does not change timeouts or introduce
  background jobs. Performance and completion handling need separate review.
- Cache-only display adjustments are still overwritten by a rebuild.
- Existing concurrency limitations in the shared rebuild remain a separate
  concern. No claim of a new concurrency guarantee is made.
- Historical snapshots, meeting notes, and ADR 0004's decision text remain
  available as evidence of the previous behavior.
