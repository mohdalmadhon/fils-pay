# 010 — Test merchants enter real settlement after status recomputation

Recorded: 2026-10-29.

Status: implemented and verified locally using a disposable database.
No production flags, batches, ledger entries, or exports were changed.

## Reported problem and root cause

Test merchants appeared in real settlement runs. The daily merchant scan
already excludes `test_mode = true`. The problem was a preceding admin
action changing that classification without a go-live decision.

`POST /v1/admin/merchants/:id/transactions/recompute-statuses` called
`reconcileSandboxFlag` after recomputing transaction statuses. Whenever
`scanned > 0` and `openAuthorizations === 0`, the helper locked the merchant
and changed `test_mode` from true to false. A routine status backfill thus
silently made a sandbox merchant eligible for the next real settlement run.

The open-authorization check was especially misleading: the recompute
query excludes `authorized` transactions, but the counter was incremented
only when a scanned row had that status. That summary therefore reports
zero even when excluded authorized rows exist. Neither zero authorizations
nor a successful status repair is evidence of approval to go live.

Example: a test merchant has captured transactions with old statuses. An
operator presses **Recompute statuses** to repair them. Previously that
same action cleared its test flag; the next daily scan treated it as live.
Now the statuses are repaired while `test_mode` remains true, so the normal
settlement scan continues to skip it.

## Fix and affected code

| Location | Change |
|---|---|
| [adminMerchantsRecompute.ts:25](../../apps/api/src/routes/adminMerchantsRecompute.ts#L25), lines 25–41 | Remove the sandbox reconciliation call; keep response and audit `flagsUpdated: []` for compatibility, in the existing status-update transaction |
| `apps/api/src/admin/merchantFlags.ts`, removed | Delete the sole automatic sandbox-clearing helper after removing its only caller |
| [MerchantDetailPage.tsx:625](../../apps/admin/src/pages/merchants/MerchantDetailPage.tsx#L625) | Tell operators that recomputing statuses preserves test/live mode |
| [Admin guide](../ADMIN.md#merchants), [runbook](../RUNBOOK.md#test-merchants-and-settlement), and [index](README.md) | Explain the corrected behavior, earlier side effect, and historical review |

The response fields, status derivation, finance/super-admin role gate,
authentication, and transactional audit remain intact. No database
migration is needed. The settlement filters already express the intended
test-mode rule and were not replaced with merchant-name exceptions.

This change removes all production-code references to the flag-clearing
helper and its `UPDATE merchants SET test_mode = false` statement. It does
not add a replacement automatic promotion path. The misleading
`openAuthorizations` summary remains a separate reporting issue; it can no
longer cause a flag change through this action.

## References and prior mentions

Use `git show 1cf04a0:<path>` for the pre-fix code, including the removed
helper. Substantive references found during this investigation:

| Reference | Evidence and limits |
|---|---|
| [September finance conversation, lines 64–68](../archive/slack-export-fp-finance-2026-09.txt#L64) | Operator reports recomputing Gamma/Alpha and seeing `testModeCleared: true`; finance asks whether the test merchant will enter settlement. The response dismisses the risk based on then-current captured activity. That does not preserve sandbox classification for future activity. |
| [Saved September audit, lines 114–115](../exports/admin-audit-2026-09.csv#L114) | Records Gamma target `5e2d7a90-14c3-4f6e-8b21-a7c9e0d4f382` with `testModeCleared: true` and another target with false. This is saved evidence, not a live production query. |
| Removed `merchantFlags.ts`, baseline lines 3–20 | Explicitly clears the sandbox flag when scanned activity has no reported open authorizations |
| [Admin route](../../apps/api/src/routes/adminMerchantsRecompute.ts), baseline lines 25–40 | Invokes that helper inside status recomputation and records `flagsUpdated` in response/audit |
| [Status recomputation helper:26](../../apps/api/src/admin/transactionStatusRecompute.ts#L26), lines 26–50 | Excludes authorized rows, then tries to count authorized rows in that result; explains why the former promotion condition was too easily met |
| [Daily selection:404](../../apps/settlement/internal/settlement/batch.go#L404) | Default run explicitly requires active, non-test merchants. Daemon, CLI, and internal admin endpoint share this function. |
| [CloseBatch:114](../../apps/settlement/internal/settlement/batch.go#L114) | Checks active/non-test eligibility before closing a new open batch |
| [CLI](../../apps/settlement/cmd/settlement/main.go#L96), [daemon](../../apps/settlement/internal/scheduler/daemon.go#L86), [internal API](../../apps/settlement/internal/internalapi/server.go#L206) | Entry points leading to the shared daily run |
| [Merchant schema](../../db/migrations/0002_merchants.sql#L9) | Defines test mode and states test merchants' transactions must not settle |
| [Gamma fixture](../../db/seed/fixtures/merchants.ts#L109) | Explicitly sets `testMode: true` and says activity must remain outside settlement until go-live |
| [Seed insertion](../../db/seed/generate.ts#L231) | Persists each fixture's test-mode classification |
| [Admin guide](../ADMIN.md#merchants), pre-fix text | Describes recomputation as status cleanup safe to repeat, without disclosing the promotion side effect |
| [UI](../../apps/admin/src/pages/merchants/MerchantDetailPage.tsx#L625) and [response type](../../apps/admin/src/types.ts#L229) | Status-maintenance button and existing `flagsUpdated` response contract |
| [Admin merchant projection](../../apps/api/src/admin/merchants.ts#L42) and [merchant list](../../apps/admin/src/pages/merchants/MerchantListPage.tsx#L199) | Read `test_mode` to display test/live classification; they cannot recover a flag that was incorrectly cleared |

The saved audit uses `testModeCleared`, `recomputed`, and `unchanged`,
whereas this checkout uses `flagsUpdated`, `scanned`, and `updated`. It also
identifies a support-role operator while this checkout requires finance or
super-admin. Those differences mean the snapshot is not proof of the exact
deployed route version. The source independently confirms the unsafe flag
change. Gamma's fixture identity also must not be substituted blindly for
a saved production merchant ID.

Architecture, handover, accepted ADRs, and changelog were reviewed. None
authorizes converting test merchants to live during transaction cleanup.
The historical documents and audit/export snapshots remain unchanged.

## Verification

Temporary TypeScript and Go harnesses exercised the real admin HTTP route
and real `RunDailyBatch` against one disposable local PostgreSQL database.
Setup applied real migrations through 0053 plus 0073; it did not edit or
bypass the shared database's unrelated migration-0054 failure. The temporary
repository harnesses and disposable database were removed afterward.

Passed checks:

- Test and live merchants retain their original flags after a status repair
  and after repeating it. Existing authorized rows are present, confirming
  that the old zero-count condition no longer promotes the test merchant.
- Stale transaction statuses are actually repaired; the repeat updates
  zero rows. Empty-history test merchants also remain test merchants.
- Five successful requests produce five real audit rows, each containing
  `flagsUpdated: []`; response metadata agrees.
- Unauthenticated requests return 401 and support-role requests return
  403, preserving existing gates.
- A default daily run processes only the live control merchant. An explicit
  run for the sandbox merchant with no existing batch is also skipped.
  No sandbox batch, event claim, or ledger entry is created.
- API and admin TypeScript checks pass.

The required full suites were run with the shared local PostgreSQL database:

- `go test ./...` retains the two balance-refresh and four finalized-MDR
  expectation failures documented in records [003](003-admin-balance-rebuild-source.md)
  and [004](004-mdr-finalized-batches.md). Config, internal API, money,
  scheduler, and splits passed. No Go production code changed here.
- `npm test` retains existing failures, including the old fee-display
  backfill expectation and missing local tables such as `adjustment_imports`,
  `credit_requests`, and `reporting_saved_filters`. The full suite is not green.
- Documentation file references and `git diff --check` passed.

Frozen money packages and regression-locked test files were not modified.

## Activation and existing affected merchants

Deploy/restart the API to remove the side effect and deploy the admin text.
There is no schema change or automatic historical data repair in this fix.

Review candidate audit records, including both metadata shapes:

```sql
SELECT created_at, target_id, admin_user_id, outcome, metadata
  FROM admin_audit_log
 WHERE action = 'transaction_status_recompute'
   AND outcome = 'succeeded'
   AND (metadata->'flagsUpdated' ? 'test_mode'
        OR metadata->>'testModeCleared' = 'true')
 ORDER BY created_at, id;
```

Confirm each merchant's approved test/live mode and any later intentional
go-live before restoring a flag. An incorrect false flag is indistinguishable
from a legitimate live merchant to the settlement scan; this code change
cannot infer and repair that history safely. Do not mass-update by name,
reseed production, reopen paid batches, or rerun payouts as remediation.

For confirmed cases, review batches, original payout postings, exports,
and activity since the clearing event. Changing test mode does not reverse
money already paid or remove previously exported activity. Any financial
correction needs its own explicit, auditable action.
