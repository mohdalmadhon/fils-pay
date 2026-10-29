# 009 — Lifetime payout estimate drifts for high-volume merchants

Recorded: 2026-10-29.

Status: code and migration prepared; verified in a disposable local database.
Migration 0073 has not been applied to the shared development database or
production. No real payout was executed or historical ledger entry changed.

## Problem and root cause

The lifetime monitoring counter used binary single-precision floating point
at two boundaries: Go converted `money.Fils` (`int64`) to `float32`, and
migration 0040 stored the running total as PostgreSQL `REAL`. Integer fils
were rounded before addition and again as the total grew. More payouts and
larger totals therefore exposed drift that the small-value test missed.

Single precision represents every integer only through 2^24 = 16,777,216
fils (16,777.216 BD). A payout of **16,777,217 fils** produced an estimate
of **16,777,216 fils** in the local reproduction. At that magnitude an
additional one-fil update can also disappear. Errors can accumulate in
either direction; this is separate from the scheme's two-decimal export.

This counter does not feed bank instructions, ledger amounts, or payout
calculations. The confirmed defect is the monitoring total. No frontend
or API reader of this specific field was found in the repository; comments
refer to an ops dashboard, which is not evidence of a wired screen.

The seed had a second defect in the same field: it replayed `Math.fround`
additions for batches that it inserted as **closed**, not **paid**. Thus a
fresh fixture could show a lifetime paid amount before any payout occurred.

## Fix and affected lines

| Reference | Change |
|---|---|
| [payout_estimate.go:12](../../apps/settlement/internal/settlement/payout_estimate.go#L12), lines 12–22 | Pass `int64(netPayoutFils)` directly; document integer units and migration dependency |
| [migration 0073:1](../../db/migrations/0073_lifetime_payout_estimate_integer_fils.sql#L1), lines 1–30 | Lock writers within the migration transaction; replace REAL with BIGINT; reconstruct from ordinary payout ledger debit legs; document units and scope |
| [generate.ts:626](../../db/seed/generate.ts#L626) | Remove float accumulation and its unused per-day net list; closed seed batches leave the counter at zero |
| [Architecture](../ARCHITECTURE.md#money), [runbook](../RUNBOOK.md#lifetime-payout-monitoring-estimate), and [index](README.md) | Document units, scope, deployment, and this evidence trail |

Changing only Go would still lose precision in REAL storage. Changing only
the column would still round individual payouts in Go. Casting old REAL
values to BIGINT would preserve an already incorrect total.

The migration instead discards the rounded estimate and sums one side of
actual payout postings: `merchant_payable`, `debit`, a non-null batch ID,
and description `settlement payout: batch paid`. Merchants without these
postings become zero. Integer `SUM` is exact; conversion to BIGINT fails if
the result exceeds its range, rolling back the migration rather than
silently rounding. Runtime overflow likewise rolls back the payout.

Using ledger postings also avoids copying historical batch totals that
the previous MDR recalculation could have rewritten after payment. No
posted ledger amount, stored batch amount, or cached payable is repaired
or altered by this migration.

## References and prior mentions

The pre-fix implementation is preserved in baseline commit `d9a587f`:
`git show d9a587f:<path>`. References found during the repository search:

| Reference | Relevance |
|---|---|
| [Migration 0040](../../db/migrations/0040_merchants_lifetime_payout_monitoring_estimate.sql#L1) | Introduces REAL, omits the unit suffix because it is monitoring-only, and says not to spend time on it. Historical migration unchanged. |
| [Payout helper](../../apps/settlement/internal/settlement/payout_estimate.go#L15), pre-fix line 19 | Casts each payout to float32 before database addition |
| [Locked small-value test](../../apps/settlement/internal/settlement/payout_estimate_test.go#L10) | Checks only 1,000 + 2,500 + 47,500 = 51,000. Its comment explicitly acknowledges drift beyond 2^24 but dismisses readership. Test unchanged. |
| [PayoutBatch](../../apps/settlement/internal/settlement/batch.go#L300) | Locks the batch, skips paid batches, posts exact payout legs, adds the estimate, and marks paid in one transaction; these guarantees remain unchanged |
| [Original seed](../../db/seed/generate.ts), baseline lines 628–642 | Explicitly reproduces REAL rounding with Math.fround; includes closed-but-unpaid history |
| [Platform-stats migration](../../db/migrations/0049_platform_stats.sql#L1) | Refers to this counter as another lightweight total. Platform volume has a different INTEGER representation and pricing role; it is outside this fix. |
| [Changelog 1.2.0](../../CHANGELOG.md#120---2026-02-23) | Records lifetime monitoring estimate introduction; no later fix is recorded there |
| [ADR 0001](../adr/0001-integer-fils.md) | Establishes integer fils/BIGINT and prohibits floating-point money arithmetic |
| [Split payout path](../../apps/settlement/internal/splits/allocate.go#L61) | Does not call this counter helper. This fix preserves ordinary-payout scope rather than adding split history only during migration. |
| [Monthly estimate](../../apps/settlement/internal/settlement/payout_estimate.go#L24) | Separate approximate 30-day helper still uses float32; not a reader of the lifetime counter and unchanged here |
| [Finalized-MDR investigation](004-mdr-finalized-batches.md) | Explains why stored paid batch totals may differ from actual historical payout postings |
| [Migration runner](../../db/migrate.ts) | Wraps each migration in BEGIN/COMMIT and tracks the filename, so schema conversion and reconstruction are atomic |

No separate historical incident note or deployed dashboard query for this
field was found. Frozen money packages and regression-locked tests remain
unchanged. The unrelated net-payable calculation is outside this fix.

## Verification

A temporary Go harness used the actual `PayoutBatch` and estimate helper
against a disposable PostgreSQL database with the real migrations through
0053, then applied real migration 0073 transactionally. It was removed from
the repository after verification; the disposable database was dropped.

Passed checks:

- Reproduce REAL losing one fil at 16,777,217; migration restores the exact
  ledger amount even after the paid batch's stored net is changed to 42.
- Closed-but-unpaid batches are excluded; merchants without paid ledger
  history reset to zero; resulting column type is BIGINT.
- Add 9,007,199,254,740,993 fils exactly (above both float32 precision and
  JavaScript's safe-integer ceiling), reading results as Go int64.
- Retried paid batches do not increment twice; zero payouts do not change
  the total; a rolled-back addition leaves the total untouched.
- Forty concurrent one-fil payouts to the same merchant are all retained.
- Replaying the migration reconstructs the same total rather than adding
  it again. The normal migration runner applies the file once.
- BIGINT overflow rejects a payout atomically: no ledger legs remain and
  the batch remains closed.

Database/seed TypeScript compilation (`npx tsc -p db --noEmit`) passed.
The unchanged small-value lifetime regression test also passed against the
migrated BIGINT schema in that disposable database.

The required full suites were run with the shared local PostgreSQL database:

- `go test ./...` failed on the same two balance-refresh and four finalized-MDR
  expectations recorded in fixes [003](003-admin-balance-rebuild-source.md)
  and [004](004-mdr-finalized-batches.md). Config, internal API, money,
  scheduler, and splits passed; the lifetime test reported no failure.
  This shared database still has the original REAL column; the disposable
  run above separately verifies the migrated schema.
- `npm test` failed on existing expectations and incomplete local schema,
  including the old fee-display backfill expectation and missing
  `adjustment_imports`, `adjustment_import_rows`, `credit_requests`,
  `reporting_saved_filters`, `settlement_payout_disbursements`, and
  `webhook_delivery_archives`. This is not a green full-suite result.
- Documentation file references and `git diff --check` passed.

## Deployment and historical limits

AGENTS.md requires DBA approval and a migration plan for column widening.
This document is the plan; preparing and testing it is not production
approval. Obtain that approval before applying 0073 to a shared deployment.

1. Confirm retained historical payout ledger coverage and the exact posting
   descriptions used by deployed versions. The reconstruction deliberately
   selects ordinary payout legs with the description above; missing or
   renamed historical postings require investigation before deployment.
2. Snapshot old estimates and expected ledger totals. Size and time the
   table rewrite/backfill on a representative copy; schedule maintenance.
3. Stop payout workers and other table writers. Apply 0073 through the
   migration runner. It locks batches/merchants exclusively and blocks ledger
   writes while rebuilding. Any failure must roll back the whole transaction.
4. Deploy the integer Go change and restart/reconnect database clients before
   resuming workers. Prepared SELECT statements can reject the changed result
   type on old connections; this was reproduced during verification.
5. Compare estimates with the read-only query below and verify a subsequent
   ordinary payout increments once by its exact integer net amount.

```sql
WITH actual AS (
  SELECT merchant_id, SUM(amount_fils) AS paid_fils
    FROM ledger_entries
   WHERE account_id = 'merchant_payable' AND direction = 'debit'
     AND settlement_batch_id IS NOT NULL
     AND description = 'settlement payout: batch paid'
   GROUP BY merchant_id
)
SELECT m.id, m.lifetime_net_payout_monitoring_estimate,
       COALESCE(a.paid_fils, 0) AS ledger_paid_fils
  FROM merchants m LEFT JOIN actual a ON a.merchant_id = m.id
 WHERE m.lifetime_net_payout_monitoring_estimate <> COALESCE(a.paid_fils, 0);
```

The query should return zero rows after migration with complete matching
history. Never rerun actual payouts to rebuild monitoring data. Any external
consumer must handle BIGINT integer fils without converting to float32 or
an unsafe JavaScript number; no such consumer was found in this repository.
Do not blindly revert the column to REAL. Take a coordinated application
and database rollback from the maintenance snapshot if deployment fails.

The shared local database still has the previously documented unrelated
migration-0054 failure. That migration chain must be resolved separately
before the normal runner can reach 0073 there; it was not bypassed or edited.
