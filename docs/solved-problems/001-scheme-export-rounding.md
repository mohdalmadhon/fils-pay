# 001 — Scheme export rounding mismatch

Recorded: 2026-10-29.

Status: implemented locally and verified for newly created export rows.
Deployment and historical reconciliation have not been performed.

## Reported problem

The scheme statement total was consistently slightly higher than our total
over three months. Investigation found a mismatch between the scheme
amount exposed internally and the amount serialized into our outbound CSV.
The saved repository export confirms this mismatch for one batch. The
three monthly statements have not been inspected, so this finding does
not establish the complete cause or amount of each month's discrepancy.

A scheme file here means the settlement CSV produced by
`settlement export-scheme-file --batch=<uuid> --out=<path>`. Its output
path is chosen by the caller. The saved example examined was
[delta-wholesale-2026-09-14.csv](../exports/scheme/delta-wholesale-2026-09-14.csv).

## Root cause

One Bahraini dinar is 1,000 fils. The scheme export uses two decimal
places, so each exported amount must represent a multiple of 10 fils.

During `CloseBatch`, the code wrote two representations of each amount:

| Representation | Previous calculation | Example for 4,747 fils |
|---|---|---|
| `scheme_export_lines.amount_fils` | Integer truncation: `(grossFils / 10) * 10` | 4,740 fils = 4.740 BD |
| `scheme_export_lines.amount` | `float64(grossFils) / 1000`, assigned to `NUMERIC(10,2)` | 4.747 BD rounds to 4.75 BD = 4,750 fils |

The two calculations diverged because the database rounded the decimal
column while the integer column was truncated. This is a difference in
conversion rules; ordinary floating-point noise is not needed to explain it.

`LoadSchemeExportLines` prefers `amount` when writing the CSV.
`listBatchTransactions` exposes `amount_fils` as `schemeAmountFils`.
For positive amounts, the decimal representation can therefore be equal
to, or 10 fils above, the internal scheme amount. This explains the
one-directional discrepancy between those representations.

The database's existing check only requires `amount_fils` to be a
nonnegative multiple of 10; it does not require the two columns to agree.

## Evidence from the saved export

Compared the CSV with its accompanying
[database snapshot](../exports/scheme/scheme_export_lines-delta-wholesale-2026-09-14.tsv),
using exact decimal arithmetic:

| Measurement | Result |
|---|---:|
| Rows | 260 |
| Sum of internal `amount_fils`, expressed in BD | 19,998.970 BD |
| Sum of exported `amount` | 20,000.200 BD |
| Difference | +1.230 BD = 1,230 fils |
| Rows with a +10 fils difference | 123 |
| Rows with no difference | 137 |
| Rows with a negative difference | 0 |

Every CSV amount matched its snapshot's `amount` column. Thus this
particular mismatch already existed in our generated file, before any
possible processing by the acquirer. These files are saved snapshots;
[their provenance notes](../exports/README.md) caution that exports may
contain staging data.

## Solution and affected lines

Keep the existing truncation rule and calculate both representations from
the resulting integer amount. Use the existing integer formatter to send
an exact two-decimal string to PostgreSQL.

At the insert in `CloseBatch`, the decimal argument changed from:

```go
SchemeAmountBD(line.grossFils)
```

to:

```go
formatFilsAsTwoDecimalString(truncated)
```

For 4,747 fils, both representations now describe 4.740 BD:
`amount_fils = 4740` and `amount = 4.74`.

| File and location | Change or role |
|---|---|
| [batch.go:250](../../apps/settlement/internal/settlement/batch.go#L250), `CloseBatch`, lines 250–257 | Reuse the truncated fils for the decimal insert argument; add a comment explaining why gross BD must not be passed to the decimal column |
| [scheme_export.go:27](../../apps/settlement/internal/settlement/scheme_export.go#L27), immediately after `TruncateToSchemeAmount` | Removed the unused `SchemeAmountBD` float conversion helper, previously at lines 27–31 |
| [scheme_export.go:96](../../apps/settlement/internal/settlement/scheme_export.go#L96), `formatFilsAsTwoDecimalString` | Existing formatter reused without modification; integer division and remainder produce the exact decimal string |
| [scheme_export.go:62](../../apps/settlement/internal/settlement/scheme_export.go#L62), `LoadSchemeExportLines` | Existing reader, unchanged; it now receives consistent values for new batches |
| [query.ts:229](../../apps/api/src/settlement/query.ts#L229), `listBatchTransactions` | Existing internal amount reader, unchanged |
| [0050 migration:12](../../db/migrations/0050_scheme_export_lines_acquirer_amount.sql#L12) | Existing `NUMERIC(10,2)` definition, unchanged |

The frozen money packages, regression tests, and existing migrations were
not modified. No new rounding rule was introduced.

## Validation

- Existing PostgreSQL-backed tests
  `TestCloseBatch_SchemeExportLineTruncation` and
  `TestSchemeExportAmountHasTwoDecimals` passed.
- A direct query of all five rows generated by those focused tests found
  zero mismatches between `amount * 1000` and `amount_fils`.
- The full Go suite passed without `DATABASE_URL`, with database-dependent
  tests skipped. With the local database configured, the settlement
  package passed; other packages failed because the
  `merchant_payable_position` view was missing.
- The full npm suite was attempted both without and with the local
  database configured. It did not pass. Without a database URL, integration
  tests require one; with the database, missing schema such as
  `live_sessions` causes failures. The local migration run previously
  stopped at `0054_views.sql`, which references the missing
  `settlement_batch_events` table.

These results verify the focused fix but do not establish that the whole
backend passes its integration suite.

## Remaining work

- Confirm the acquirer's required conversion rule. This fix makes our
  representations agree under the current truncation policy; it does not
  establish whether truncation is contractually correct.
- Compare the three reported monthly statements with their actual exports
  using matching batches and date windows.
- Reconcile historical mismatches. Existing closed batches and their stored
  `amount` values are unchanged; exporting an old batch again still uses
  those stored values. No backfill or ledger correction was performed.
- Resolve the separate migration failure and rerun the complete integration
  suite against a fully migrated database.
- Investigate any residual ledger or scheme-residue discrepancy separately.
  This change only fixes the inconsistent amount representations.
