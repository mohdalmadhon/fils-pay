# Fix report: balance cache wrong after "Rebuild cached balances"

| | |
|---|---|
| **Status** | Fixed (uncommitted in the working tree) |
| **Severity** | High. A merchant's balance on the dashboard and in the admin console was overwritten with a figure that had nothing to do with what they are owed (135,000 BD shown as 7,000 BD). Support then "corrected" balances by hand on top of the wrong figure. |
| **Component** | `apps/settlement`: internal API `POST /internal/rebuild-balances`, package `internal/ledger` |
| **Reported** | An admin clicked "Rebuild cached balances" and a merchant's balance dropped from 135K to 7K. The CLI gave the right number. |
| **Date** | 2026-10-29 |

## Summary

There were two different "rebuild balances" implementations, reading from two
different places:

| Path | Function | Source |
|---|---|---|
| CLI `settlement rebuild-balances` | `ledger.RebuildAllBalances` | `ledger_entries`, summing `merchant_payable` legs |
| Admin button → `POST /internal/rebuild-balances` | `ledger.RefreshBalanceCache` | view `merchant_payable_position` = **sum of `scheme_export_lines.amount_fils`** |

The view counts only the **gross amount of captures that have been batched**.
It ignores:

- MDR fees and negotiated-discount adjustments
- payouts already sent (so paid-out money is still counted as owed)
- manual credits and CSV adjustment imports
- every capture **not yet in a settlement batch**

A merchant with a lot of recent, not-yet-batched volume therefore collapses
to a small number. That is the 135K → 7K case. A merchant whose money has
already been paid out jumps up instead.

The fix removes the second implementation. The button now runs exactly the
same ledger recompute as the CLI.

## Where it was found

- `apps/settlement/internal/internalapi/server.go`, `handleRebuildBalances`:
  called `ledger.RefreshBalanceCache`, not `ledger.RebuildAllBalances`.
- `apps/settlement/internal/ledger/refresh.go`: `RefreshBalanceCache` read
  `merchant_payable_position`.
- `db/migrations/0054_views.sql`: defines that view as
  `SUM(sel.amount_fils)` over `scheme_export_lines` joined to
  `settlement_batches`. This is one of the "abandoned" migrations, and it
  can't even be applied to a fresh database.
- `docs/adr/0004-balance-rebuild-source.md`: the decision behind it, "the
  console button rebuilds from a faster query path using settled data". It
  claimed the two paths "agree whenever the cache is consistent with settled
  activity", which is never true for a real merchant.

**Earlier warnings that were ignored:**

- `docs/HANDOVER.md` (Yousif): "There is no console button, and there
  shouldn't be one that reads anything else."
- `cmd/settlement/main.go`, YA: "CLI rebuild goes from ledger_entries. the
  admin button goes somewhere else". MK replied: "same thing, different
  source. both fine."
- `docs/ARCHITECTURE.md`, `docs/ADMIN.md`, `docs/RUNBOOK.md` and the Slack
  export ("same thing, through the internal API") all told support the button
  ran the same thing as the CLI.
- The existing tests locked the wrong source in: `refresh_test.go` asserted
  the scheme-export total, and a comment in `server_test.go` said "12000 =
  export total = what support sees in the console, so the test is right".
- 15 Sept 2026 (FP-203 review, `docs/exports/merchant-balances-rebuild-2026-09-15.csv`):
  a rebuild changed several balances, and support then used **Adjust
  balance** to put them back to statement figures. Those adjustments only
  changed the cache, never the ledger.

## Reproduction

New test file
`apps/settlement/internal/internalapi/rebuild_source_test.go`, against a
real migrated Postgres, **before** the fix. The test merchant's ledger
payable is 135,000.000 BD:

- a 10,000 BD capture, batched and paid out
- a 7,000 BD capture, batched, minus a 175 BD fee
- 128,175 BD of captures not yet batched

| Test | Expected | Before fix |
|---|---|---|
| Button rebuild of that merchant | 135,000,000 fils | **17,000,000 fils** written to the cache |
| Button rebuild vs `RebuildMerchantBalance` (what the CLI prints) | equal | 17,000,000 vs 135,000,000 |
| Merchant with captures but no batch yet | included, 4,750 fils | **missing** from the rebuild |

## Fix

| File | Change |
|---|---|
| `apps/settlement/internal/internalapi/server.go` | `handleRebuildBalances` now calls `ledger.RebuildAllBalances`, the same function as the CLI. The response shape (`before`/`after`/`changed` per merchant) is unchanged, so the admin console needs no change. |
| `apps/settlement/internal/ledger/rebuild.go` | `RebuildAllBalances` rewritten: a single grouped pass over `ledger_entries` for all merchants, replacing 2 queries per merchant (the cold-ledger slowness ADR-0004 cited as its reason for a "faster path"), then one bulk upsert. It also takes `LOCK TABLE merchant_balances IN SHARE ROW EXCLUSIVE MODE` before reading the ledger. That closes YA's old TODO ("a concurrent CloseBatch increment gets clobbered"): a concurrent close, payout or credit waits at its cache update and then applies its delta on top of the rebuilt value. Reads of the cache are not blocked. |
| `apps/settlement/internal/ledger/refresh.go`, `refresh_test.go` | **Deleted.** `RefreshBalanceCache` was the wrong source, and its tests only asserted that wrong behaviour. |
| `apps/settlement/cmd/settlement/main.go` | Comment updated: both paths call the same function. |
| `apps/settlement/internal/internalapi/rebuild_source_test.go` (new) | The three regression tests above. |
| `docs/adr/0007-balance-rebuild-reads-the-ledger.md` (new), `0004` status, `README.md` | ADR-0007 supersedes ADR-0004, following the ADR rule "never edit an accepted decision; write a new one". |

## Verification

- New tests: 3/3 pass after the fix (all failed before).
- Whole Go module (`go test ./...`, DB-backed): all packages pass, including
  the existing `TestRebuildBalances_ValidToken` and
  `TestRebuildAllBalances_OverwritesDriftedCache`, unchanged.
- `go build ./...` and `go vet ./...` are clean.
- Nothing in Go or TypeScript references `RefreshBalanceCache` or
  `merchant_payable_position` any more.

Test environment notes:

- The Go module proxy is blocked in the test environment, so dependencies
  were fetched from their GitHub mirrors through a temporary `-modfile`. The
  repo's `go.mod`/`go.sum` are untouched.
- As before, a fresh database can't migrate past `0054_views.sql`, so 0054 and
  0055 were skipped in the throwaway test database.

## Deploying and repairing data

1. Rebuild and restart the settlement service. No database migration is needed.
2. Click **Rebuild cached balances** once, or run `settlement rebuild-balances`.
   Both now produce the ledger figure, and every merchant's cache goes back to
   what they are actually owed.
3. That rebuild **will undo the cache-only "Adjust balance" corrections**
   support made after the wrong rebuilds (e.g. 15 Sept). This is intended:
   those corrections were compensating for the wrong figure. If a statement
   still disagrees with the rebuilt (ledger) balance, the real fix is a ledger
   posting (credit or journaled adjustment), not another cache edit.

## Related, not changed here

- **Adjust balance** in the console is cache-only (ADR-0006), even though
  `docs/ADMIN.md` says it is "journaled to the ledger". Any rebuild silently
  wipes it.
- `settlement rebuild-balances --merchant=<id>` only prints the ledger figure.
  Despite the code comment, it never writes the cache.
- `docs/ARCHITECTURE.md` and `docs/ADMIN.md` mention a nightly 02:00 balance
  refresh. No such job exists in the daemon.
- If the full rebuild ever exceeds the API's 30-second internal-call timeout
  (`SETTLEMENT_INTERNAL_REQUEST_TIMEOUT_MS`), raise the timeout or use the CLI.
  Never switch back to a different data source.
