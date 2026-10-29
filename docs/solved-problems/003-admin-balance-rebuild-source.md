# 003 — Admin/CLI balance rebuild mismatch (problem 4)

Recorded: 2026-10-29. User investigation number: problem 4.

Merge integration: the finance branch initially retained a delegating
`RefreshBalanceCache` wrapper. The combined implementation preserves main's
removal of that wrapper: the internal endpoint and CLI call
`RebuildAllBalances` directly. Main's cache table lock and aggregate rebuild
are retained. The original implementation and verification below are
historical; see [merge decisions](013-finance-main-merge.md) and
[canonical ADR 0007](../adr/0007-balance-rebuild-reads-the-ledger.md).

Status: implemented locally; focused verification uses synthetic data in the
isolated local PostgreSQL database. No production rebuild or historical
balance correction has been performed.

## Reported incident

The user reported that Alpha Retail's balance fell from roughly 135k to 7k
after pressing **Rebuild cached balances**, and that a CLI rebuild restored
it. The date was described as "last Thursday". The repository's saved
September snapshots do not establish that exact incident or those amounts.

The code confirms a source mismatch that can cause large changes in either
direction. This record distinguishes that confirmed defect from the
unverified details of the reported production incident.

## Root cause

The same cached field was overwritten from two different financial measures:

| Entry point before this fix | Source | Meaning |
|---|---|---|
| Admin button → internal API → `RefreshBalanceCache` | `merchant_payable_position` | Sum of gross scheme-export `amount_fils` values |
| Full CLI → `RebuildAllBalances` | `ledger_entries`, account `merchant_payable` | Outstanding liability: credits minus debits |

The view is defined in [migration 0054](../../db/migrations/0054_views.sql#L3).
It sums export amounts across batches with no date or paid-status filter.
It does not calculate a current liability: it does not deduct fees and
payouts or incorporate all payable credits, refunds, and journaled
adjustments. It also uses the truncated scheme amounts rather than complete
payable ledger movements.

`RefreshBalanceCache` assigned that export-volume figure directly to
`merchant_balances.cached_payable_fils`. No ledger money movement occurred;
the display cache was replaced with a different financial quantity. The
full CLI then recomputed the liability from the ledger and overwrote the
cache again, explaining why the two paths could disagree so dramatically.

This was a documented performance shortcut, not a conversion of BD into
fils. A faster source was treated as equivalent even though it omitted the
movements needed to derive an outstanding balance.

## Evidence and previous mentions

Historical references are preserved rather than rewritten to describe the
new behavior:

| Reference | What it establishes |
|---|---|
| [ADR 0004](../adr/0004-balance-rebuild-source.md) | Deliberately selected a faster settled-data source for the button while keeping the CLI's ledger calculation; reported about 40 seconds for a cold ledger rebuild |
| [Architecture, ledger section](../ARCHITECTURE.md#the-ledger) | Identifies the ledger as the money-movement record and describes the button as equivalent to the CLI, contradicting the old implementation |
| [Changelog 1.7.0](../../CHANGELOG.md#170---2026-06-03) | Describes the new button as the same rebuild as the CLI |
| [September 17 FP-203 review](../meetings/2026-09-17-fp-203-review.md#background) | Records changed balances after September 15's rebuild and the workaround of manually adjusting the cache back |
| [Finance discussion, September 15](../archive/slack-export-fp-finance-2026-09.txt#L58) | Operators report changed balances and follow the Rebuild → Adjust workflow |
| [September balance snapshot](../exports/merchant-balances-rebuild-2026-09-15.csv) | Alpha changed from 4,328,458 to 4,118,226 fils; this is evidence of a different recorded event, not the user's 135k → 7k incident |
| [September audit export](../exports/admin-audit-2026-09.csv#L90) | Successful rebuild records explicitly name `scheme_export_lines` as the source; a repeat reports no changes, showing repeatability alone did not validate the financial meaning |
| [Admin frontend comment](../../apps/admin/src/pages/settlement/SettlementPage.tsx#L76) | Reports Alpha's balance jumping after a staging rebuild; this is a code comment, not a verified production incident record |
| [Refresh regression tests](../../apps/settlement/internal/ledger/refresh_test.go#L37) | Assert export-line sums as rebuilt balances; these tests encode the previous source rather than agreement with the payable ledger |

## Fix and affected lines

`RefreshBalanceCache` now delegates directly to `RebuildAllBalances`:

```go
return RebuildAllBalances(ctx, db)
```

Both entry points therefore share merchant discovery, the payable-ledger
sum, transaction handling, cache writes, and the before/after result map.
The HTTP response shape and admin frontend do not change. With the same
ledger state, both paths now produce the same result.

| File and location | Change or role |
|---|---|
| Historical `apps/settlement/internal/ledger/refresh.go`, lines 10–15 | Originally delegated to the ledger rebuild; main later removed the wrapper. Inspect it in finance commit `13ebf6a`. |
| [rebuild.go:1](../../apps/settlement/internal/ledger/rebuild.go#L1) and [rebuild.go:53](../../apps/settlement/internal/ledger/rebuild.go#L53) | Update ownership comments to include the admin caller; calculation and transaction logic are unchanged |
| [main.go:139](../../apps/settlement/cmd/settlement/main.go#L139) | Replace the obsolete comment claiming the CLI and button use different sources; no CLI behavior change |
| [server.go:266](../../apps/settlement/internal/internalapi/server.go#L266) | Unchanged admin endpoint continues calling `RefreshBalanceCache` and returning before/after differences |
| [ADR 0007](../adr/0007-ledger-backed-admin-balance-rebuild.md) | Record the new source decision and its limits; supersede ADR 0004 by changing only its status line |
| [Admin guide](../ADMIN.md#settlement-ops) and [runbook](../RUNBOOK.md#a-merchants-balance-looks-wrong) | Describe the common ledger source and remaining operational limitations |

## Verification

A temporary Go harness invoked the real internal HTTP handler with a valid
bearer token and compared its results and persisted cache values with
`RebuildMerchantBalance` and `RebuildAllBalances`. It was removed from the
working tree afterward; regression-locked test files remain unchanged.

- Synthetic ledger: 150,000,000 fils captured, 5,000,000 in fees, and
  10,000,000 paid out. Scheme export total: 7,000,000 fils. Admin and CLI
  both restored the expected 135,000,000-fils liability. These values are
  an illustration of the reported failure, not recovered production data.
- A credit-only merchant with no export rows rebuilt to 1,200 fils after
  a 1,500-fil credit and 300-fil debit.
- A merchant present only in the cache rebuilt to zero.
- A negative payable balance remained negative; a merchant with ledger
  activity but no cache row received a cache row.
- Repeating both rebuild paths with unchanged ledger state reported no
  changes for those merchants. Rebuilds inserted no ledger entries.

The full PostgreSQL-backed `go test ./...` run passed the internal API,
settlement, splits, money, config, and scheduler packages. The ledger package
failed these two existing tests, which assert the previous export source:

- `TestRefreshBalanceCache_OverwritesDriftedCache`: expects 25,000 fils from
  an export line despite no payable ledger entries; the corrected result is
  zero.
- `TestRefreshBalanceCache_SumsAcrossBatches`: expects 21,000 fils from
  export-only batches. With neither payable ledger entries nor an existing
  cache row, that merchant is not selected by the full CLI implementation.

These regression-locked tests were not edited or bypassed. They remain an
explicit validation conflict with the requested source correction; the full
Go suite is not green. The independent handler/CLI verification above checks
the requested ledger behavior.

The full PostgreSQL-backed `npm test` run also failed. Its output includes
missing relations from migrations after the existing `0054_views.sql`
failure, including `live_sessions`, `credit_requests`, `adjustment_imports`,
and `reporting_saved_filters`. This run does not establish a passing full
backend suite. Documentation file links and `git diff --check` were verified.

## Scope and remaining concerns

This fix changes only the admin rebuild's source to the existing full CLI
calculation. It does not change ledger entries, payout logic, fee
recalculation, split allocations, cache-only adjustment behavior, existing
migrations, or production balances.

Related findings are recorded here without expanding the implementation:

- The full ledger rebuild may exceed the current 30-second internal HTTP
  timeout. This change does not make it faster, increase the timeout, or
  create a background task. Production completion behavior needs separate
  validation before relying on the button for large datasets.
- The existing CLI rebuild has a TODO about concurrent balance updates
  being overwritten. Sharing that code removes the source mismatch but
  does not resolve that concurrency concern.
- `settlement rebuild-balances --merchant=<uuid>` currently calculates and
  prints a ledger balance without writing the cache. Only the full CLI
  branch performs the cache rebuild. This behavior is unchanged.
- Cache-only display adjustments are still lost on rebuild. Whether those
  adjustments should be journaled is a separate decision, covered by
  [ADR 0006](../adr/0006-display-adjustments.md).
- The local migration failure at `0054_views.sql` remains unresolved. The
  admin rebuild no longer depends on its export-volume view; other uses of
  that migration are outside this fix.
- Confirm the user's precise Alpha incident against its actual audit rows,
  CLI output, and ledger history before asserting the historical amounts.
