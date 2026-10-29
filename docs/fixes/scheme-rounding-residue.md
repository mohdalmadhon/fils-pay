# Fix report: scheme rounding residue was never journalled

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium. 0-9 fils per settled transaction sat in `card_scheme_clearing` with nothing explaining them, so the ledger could not tie to the scheme file. Small per line, but it adds up every day for every merchant. |
| **Component** | `apps/settlement/internal/settlement/batch.go` (CloseBatch), `scheme_export.go` |
| **Found** | End-to-end check on 2026-10-30. A 47.333 BHD payment was exported to the scheme as 47.33, and the 3 fils difference appeared nowhere in the ledger. |

## Summary

The card scheme settles in two decimals, so each export line is truncated to
a multiple of 10 fils. ADR 0002 (accepted) decided how to record the
difference: at export, post `card_scheme_clearing` credit and
`scheme_rounding_residue` debit for each line. The ADR, and ARCHITECTURE.md
through it, said this had been done in CloseBatch since March 2026.

It hadn't. CloseBatch wrote the truncated `scheme_export_lines` row and no
ledger entry. Capture had debited `card_scheme_clearing` with the full gross,
and nothing ever relieved the residue, so clearing ran 0-9 fils over the
scheme file on every line. The developer comment on `TruncateToSchemeAmount`
said as much: *"where does the third go? asked twice. told to leave it until
after the audit."*

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `settlement: name the scheme rounding residue per export line` | `SchemeRoundingResidue(gross)`, with a unit test. |
| 2 | `settlement: journal the scheme rounding residue when a batch closes` | In the export loop, in the same transaction: one balanced group per line with a residue. It carries the transaction and batch IDs and is skipped when the residue is zero. Merchant payable is untouched. |
| 3 | `test: closing a batch journals the residue and ties clearing to the scheme file` | Residues of 7, 3 and 0 fils. Checks the legs, that clearing equals the scheme total, and that a re-close posts nothing twice. Fails before the fix, passes after. |
| 4 | `docs: ADR 0002 records where the residue posting actually lives` | Corrects the false "implemented in March" note and records the backfill need. |
| 5 | `docs: fix report for the scheme rounding residue` | This file. |

## Verified

- All `CloseBatch`, `CloseAndPayout` and `PayoutBatch` DB tests pass, plus the new one.
- The 47.333 BHD end-to-end payment now produces a 3-fils residue group. The ledger balances, and `card_scheme_clearing` for the transaction equals 47,330, the scheme figure.

## Not done here (needs finance)

Batches closed before this fix have no residue groups. A backfill would post
one group per historical `scheme_export_lines` row where
`gross - amount_fils > 0`. That is a reviewed, one-off finance task like the
March sweep, so it is not automated.
