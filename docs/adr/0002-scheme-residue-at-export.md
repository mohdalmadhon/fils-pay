# 0002. Journal scheme rounding residue at export

- **Status:** Accepted. Implemented in CloseBatch 2026-10-30 (the "2026-03" note below was wrong; see the history note)
- **Date:** 2025-11-20
- **Deciders:** Yousif Al-Ansari, Huda (finance)
- **Related:** 0001, FP-187, "verify residue with Visa" (ARCHITECTURE)

## Context

The card scheme settles in two decimals. Each exported line is truncated to
the nearest 10 fils, so 0–9 fils per line never reach the scheme. Over a
month this is a few BD per busy merchant. If the residue is not recorded,
the ledger, the settlement report and the scheme statement cannot all agree.

Options considered:

| Option | Pros | Cons |
|---|---|---|
| A. Journal residue per line at export into a suspense account | Ledger always ties to scheme file; auditable per line | One extra entry group per line |
| B. Monthly sweep script by finance | No code in the hot path | Month-end depends on a manual run; easy to get the window wrong |
| C. Send three decimals to the scheme | No residue at all | Scheme rejects 3dp in `amount`; `amount_minor` support unconfirmed |

## Decision

Option A. At export, for each line, post a balanced group:

| Leg | Account | Direction | Amount |
|---|---|---|---|
| 1 | `card_scheme_clearing` | credit | `gross_fils - amount_fils` |
| 2 | `scheme_rounding_residue` | debit | `gross_fils - amount_fils` |

Finance clears `scheme_rounding_residue` monthly against the scheme
statement.

## Implementation notes

Implemented inside `CloseBatch`, in the same transaction and loop as the
`scheme_export_lines` insert (`internal/settlement/batch.go`). For each line:

- `residue = SchemeRoundingResidue(gross) = gross - TruncateToSchemeAmount(gross)`,
  always 0-9 fils.
- If `residue > 0`, one balanced group is posted with `transaction_id` and
  `settlement_batch_id` set and description `scheme export: rounding residue`:
  `scheme_rounding_residue` debit and `card_scheme_clearing` credit, each for
  `residue`.
- Merchant payable is not touched; the merchant is owed and paid the full net.

After close, `card_scheme_clearing` for a batch's transactions nets to the
scheme file total exactly. `TestCloseBatch_JournalsSchemeRoundingResidue`
checks this.

**History.** This ADR was marked "implemented (March 2026)" but no code
posted the residue until 2026-10-30. Batches closed before then have no
residue groups. `scripts/reconcile_march.ts` was a separate one-off for March
only, with its own leg layout; it is not this posting. Batches closed between
April and the fix need a reviewed backfill with finance (one group per
`scheme_export_lines` row where `gross - amount_fils > 0`). It is not
automated, on purpose.

## Consequences

- No month-end sweep is needed from April onwards.
- `scheme_rounding_residue` must exist in the chart of accounts (migration
  0007 seed).
- The scheme file `amount` must be exactly `amount_fils / 1000` formatted to
  two decimals, or the residue is wrong.
