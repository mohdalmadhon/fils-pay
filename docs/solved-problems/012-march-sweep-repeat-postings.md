# 012 — March residue sweep posts again on every run

Recorded: 2026-10-29.

Status: fixed and verified in a disposable local PostgreSQL database.
The script was not applied to the shared development database or production.
No historical sweep posting was deleted, reversed, or adopted automatically.

## Prerequisite and reported continuation

The prerequisite was the scheme statement consistently exceeding the
internal total. [Record 001](001-scheme-export-rounding.md) documents the
fixed mismatch between rounded decimal scheme amounts and truncated integer
amounts. That fix affects new exports; it does not repair historical ledger
corrections or make the March sweep safe to repeat.

The continuation reports two staging runs doubling the correction and an
unknown production execution count, with only one surviving log timestamp.
The source confirms that each successful original invocation posted again.
The actual staging/production run counts were not queried in this task.

## Root cause

The original script selected March transactions, calculated each captured
amount modulo 10, and grouped the residue by merchant. It then posted a
balanced pair for every merchant: debit `merchant_payable`, credit
`scheme_rounding_residue`.

Every run generated a fresh random UUID. There was no check for an existing
correction, no stable operation key, and no concurrency protection around
checking/posting. A 70-fil correction therefore became 140 fils after two
successful identical runs. Each pair still balanced, so the ledger's
deferred balancing trigger accepted both. That trigger enforces balanced
entries, not the business rule that a correction happens once.

The source comment saying the group ID deduplicated the sweep was false.
The runbook also claimed a description check that did not exist. Meeting
notes described a dry run, but the original CLI had no dry-run mode. It
printed output to stdout without creating the referenced log file or a
durable execution register. One remaining timestamp cannot establish how
many transactions committed.

## Fix and affected lines

| Reference | Change |
|---|---|
| [reconcile_march.ts:12](../../scripts/reconcile_march.ts#L12) | Keep the exact legacy description for discovery; distinguish new receipts with a source hash suffix |
| [reconcile_march.ts:38](../../scripts/reconcile_march.ts#L38), `marchSweepGroupId` | Derive a stable UUID v8 from the operation/version and merchant, rather than a new random ID per run |
| [reconcile_march.ts:47](../../scripts/reconcile_march.ts#L47), source query and grouping | Keep original UTC March selection and per-transaction residue semantics; fingerprint ordered transaction IDs, exact captured amounts, and occurrence timestamps; calculate database BIGINT remainders without unsafe Number conversion |
| [reconcile_march.ts:102](../../scripts/reconcile_march.ts#L102), `runMarchSweep` | Own the transaction; make default preview repeatable-read/read-only; serialize applies with table locks before reading source/history |
| [reconcile_march.ts:115](../../scripts/reconcile_march.ts#L115), history validation | Read complete known groups and expected-key collisions; verify merchant, amount, fingerprint, accounts, directions, and exactly two unlinked legs before treating a posting as already applied |
| [reconcile_march.ts:154](../../scripts/reconcile_march.ts#L154), posting/commit | Post only pending groups if the entire plan is unblocked; roll back on statement or deferred-commit failure; return success only after commit |
| [reconcile_march.ts:179](../../scripts/reconcile_march.ts#L179), CLI | Support default/explicit `--dry-run` and explicit `--apply`; reject unknown/conflicting flags; print stable group IDs/outcomes and return nonzero on blocked history |
| [Runbook](../RUNBOOK.md#month-end-residue-finance), [onboarding](../ONBOARDING.md), and [index](README.md) | Replace unsafe active instructions; preserve earlier statements with a dated correction and link to this evidence |

No migration, frozen money-package change, or locked-test edit is needed.
The existing ledger is the durable posting receipt: stable group ID,
merchant, two exact amounts, source fingerprint in the description, and
stored timestamps. File output is supporting evidence, not the authority.

## Behavior on repeat or uncertain history

| Database state | Result |
|---|---|
| No matching historical groups | Preview reports pending; explicit apply posts each merchant once |
| Exact new-format correction already exists | `already_applied`; no added legs or timestamp changes |
| Two updated copies apply concurrently | Table locks serialize the whole check/post; the later run sees completed groups and skips them |
| Any old random-ID sweep group exists, even one | Block the whole apply; do not assume it is valid, adopt it, or post another correction |
| Duplicate, extra, altered, or unrelated legs under an expected key | Block the whole apply |
| Source fingerprint or amounts changed | Block; do not post an incremental difference automatically |
| Known prior group no longer has matching source rows | Block, even when the current source selection is empty |
| Unknown or conflicting CLI flags | Fail before connecting/posting |

Apply locks `transactions` in SHARE mode, then `ledger_entries` in SHARE ROW
EXCLUSIVE mode. This stabilizes source data and serializes ledger writes
for the operation, including writers that do not use an advisory lock.
Lock acquisition times out after 10 seconds rather than waiting indefinitely.
Preview takes no such write-blocking table locks and writes no rows.

The ledger has no unique business-operation constraint. Idempotency is
enforced by this transaction's locking and full history check, not by UUID
generation alone. Old script copies can still write again after these locks
are released; retire them before use. This is intentionally a maintenance
tool, not a new background job on the payment path.

## References and earlier mentions

The pre-fix code and removed instructions are preserved in baseline
`dd376ea`; inspect them with `git show dd376ea:<path>`.

| Reference | Evidence and limits |
|---|---|
| Original [script](../../scripts/reconcile_march.ts), baseline lines 71–80 | Claims entry-group deduplication but calls `randomUUID()` and inserts without checking history |
| Original script, baseline lines 95–124 | Reads source before BEGIN, posts every selected merchant, prints a single invocation timestamp, and has no CLI-mode parsing or file logger |
| [July 8 finance/engineering meeting](../meetings/2026-07-08-finance-eng.md#L15) | Calls July 3 a dry run, records 13 lines/70 fils, and concludes rerunning is safe. Identical computed amounts do not prove duplicate posting is prevented. Historical note preserved. |
| [Runbook](../RUNBOOK.md#month-end-residue-finance), baseline | Claims a description check makes reruns no-ops and recommends copying the script for future months. Those instructions are replaced. |
| [Onboarding FP-187](../ONBOARDING.md#L86) | References `scripts/out/`, 13 lines/0.070 BD and a separate theory for the remaining gap. Those numbers are historical claims, not verified production postings. |
| [Handover March-close note](../HANDOVER.md#L30) | Describes a one-off and asks for the Bahrain month; contrasts with the implemented UTC window |
| [Changelog 1.3.1](../../CHANGELOG.md#131---2026-03-19) | Says March residue was swept and March ties out; does not establish one execution or explain subsequent reruns |
| [ADR 0002](../adr/0002-scheme-residue-at-export.md) | Describes March as a one-off and intended per-line export postings; does not provide idempotency for this script |
| [ADR 0003](../adr/0003-report-date-windows.md) | Accepted policy uses UTC calendar months for finance scripts. This fix preserves that window and does not settle the Bahrain-month reconciliation dispute. |
| [Settlement-v2 design](../design/settlement-v2.md#L39) | Mentions the March sweep and intended future ledger idempotency; does not protect current v1 postings |
| [Ledger migration 0007](../../db/migrations/0007_ledger_double_entry.sql#L24) | Group IDs are not unique operation receipts by themselves; multiple legs share a group. Balancing alone allows duplicate balanced groups. |
| [Locked unit tests](../../scripts/reconcile_march.test.ts) | Cover residue arithmetic and a 31-day month; they do not exercise reruns |
| [Locked integration test](../../scripts/reconcile_march.integration.test.ts) | Compares arithmetic over a temporary captures table; it never invokes the actual posting path or tests idempotency |
| [March seed fixture](../../db/seed/fixtures/marchReconciliation.ts#L10) | Deliberately includes Bahrain March-1 activity outside UTC March; useful evidence of a separate scope issue, not proof of production execution counts |
| [Prerequisite rounding fix](001-scheme-export-rounding.md) | Corrects new scheme-export representations; does not correct old sweep groups or validate this script's financial posting policy |

`scripts/out/reconcile-2026-03.log` was not present in this checkout. No saved
production sweep ledger rows were located in the repository exports.

## Verification

A temporary harness created a disposable PostgreSQL database, applied real
migrations through 0053, and exercised the actual exported function and
CLI. It was removed afterward and the disposable database was dropped.

Passed 14 scenarios covering:

- Default and explicit read-only previews; actual `--apply`; read-only
  preview after application and exact retries preserving every existing row.
- Exact residue calculation for captured amounts above 2^53, exclusion of
  zero residues and UTC month-boundary rows, and distinct stable merchant keys.
- Changed captured amount with the same remainder still blocks via fingerprint.
- One legacy run, two legacy runs, and legacy history with no current source
  all block without any additional posting, including across merchants.
- Two concurrent real-client applies post one pair per merchant in total.
- Extra balanced legs under a canonical key block rather than being ignored.
- An insert failure after earlier work rolls back every merchant's postings.
- A deferred trigger failure during COMMIT also leaves no posting.
- Unknown/conflicting CLI flags and blocked history return nonzero and
  preserve existing ledger rows.

Final checks:

- `npx tsc -p scripts --noEmit` passed.
- The three unchanged March tests passed when invoked directly, including
  the PostgreSQL-backed 2,000-row arithmetic check. They were run directly
  because the full npm command fails before reaching root script tests.
- Required `npm test` was run with the shared local database and retained
  existing failures, including the old fee-display backfill expectation
  and missing local tables such as `adjustment_imports`, `credit_requests`,
  and `reporting_saved_filters`.
- Required `go test ./...` retained two balance-refresh and four
  finalized-MDR expectation failures documented in records
  [003](003-admin-balance-rebuild-source.md) and
  [004](004-mdr-finalized-batches.md). Config, internal API, money,
  scheduler, and splits passed. No Go code changed in this fix.
- Documentation file references and `git diff --check` passed.

The full suites are not green. No test file was edited and no live
correction was executed.

## Operating and historical remediation

Use the corrected checkout, retire old deployed/manual copies, and start
with the runbook's dry-run command on the intended database. Review finance
scope before any explicit apply. This script covers **March 2026 in UTC**,
not all Q1, and retains the original transaction selection and posting
accounts/directions. Idempotency does not certify those choices as the
correct repair for a particular scheme statement.

Read historical groups independently of any output file:

```sql
WITH sweep_groups AS (
  SELECT DISTINCT entry_group_id FROM ledger_entries
   WHERE description = 'March 2026 scheme rounding residue sweep — manual recon per finance'
      OR starts_with(description,
         'March 2026 scheme rounding residue sweep — manual recon per finance; source_sha256=')
)
SELECT e.merchant_id, e.entry_group_id, e.account_id, e.direction,
       e.amount_fils, e.occurred_at, e.created_at, e.description
  FROM ledger_entries e JOIN sweep_groups g USING (entry_group_id)
 ORDER BY e.created_at, e.entry_group_id, e.id;
```

This shows actual committed legs and their timestamps, including all legs
of a matching group. Compare groups per merchant with original correction
support and any later reversals; different group IDs alone are not proof
that two postings were legitimate. Changed descriptions can hide legacy
postings from automatic discovery, so also examine retained operational
evidence and broader ledger activity where provenance is uncertain.

Do not delete, relabel, or edit old groups to bypass a blocked preview.
Confirmed duplicate corrections require separately reviewed balanced
reversal/adjustment entries referencing the originals. No force/adopt/reset
option is supplied. If legacy history is already present, this script now
stops rather than pretending a fresh run repairs it.

The shared local migration chain still fails at unrelated 0054; it was not
changed here. The script needs the existing transaction and ledger tables,
not a new migration. Production execution counts, duplicate amounts, and
the remaining historical reconciliation gap still require real ledger and
statement evidence.
