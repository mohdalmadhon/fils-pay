# Fix report: a fresh `npm run migrate` stopped at 0054

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. No new environment (a teammate's laptop, CI, a new server) could build the schema. Migrate stopped at `0054_views.sql`, so 0055–0077 never applied. |
| **Component** | `db/migrations/0054_views.sql`, `db/migrations/0055_chart_of_accounts_suspense.sql` |
| **Found** | End-to-end check on an empty database, 2026-10-30 |

## Summary

Two migrations were written against schema that never existed:

- **0054**: the `v_unbatched_capture_events` view checked a `settlement_batch_events` table. There is no such table. A capture is batched when CloseBatch stamps `transaction_events.settlement_batch_id` (added in 0023).
- **0055**: it inserted into `chart_of_accounts (code, account_type, description)`. 0007 created the table as `(id, name, kind)`.

Each migration runs in a transaction, and the runner stops at the first
failure. On an empty database migrate therefore applied 0001–0053, failed on
0054, and never reached 0055–0077. Existing dev databases only worked because
0054 and 0055 had been skipped by hand; their `schema_migrations` has no rows
for those two files.

Nothing in the code reads either view or account, which is why the running
app never showed it.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `db: point the unbatched-captures view at transaction_events.settlement_batch_id` | Uses the real batching column. `CREATE OR REPLACE` keeps it safe to apply anywhere. |
| 2 | `db: insert the suspense accounts with chart_of_accounts' real columns` | The same two accounts, with `(id, name, kind)`, as `asset` like 0007's `scheme_rounding_residue`, plus `ON CONFLICT (id) DO NOTHING`. |
| 3 | `test: every migration applies to an empty database` | `db/migrate.integration.test.ts` creates a throwaway database, migrates it, checks all 72 files applied, re-runs to check it's a no-op, and checks the view and accounts. It fails on the old 0054 and passes now. |
| 4 | `runbook: recover a database that skipped 0054/0055` | Symptom, recovery (just migrate again), and how to check. |
| 5 | `docs: fix report for the fresh-migration failure` | This file. |

## Verified

- Empty database: `72 migration(s) applied, 0 already up to date`, and a second run applies 0.
- A copy of a dev database built the old way (0054 and 0055 skipped): migrate applies `0054`, `0055` and `0073_lifetime_payout_estimate_integer_fils`. That last one had also never run there.
- Seed on the fresh database: all REAL assertions pass.

## Deploying

Run `npm run migrate` as usual. On a database built before this fix, expect
it to also apply `0073_lifetime_payout_estimate_integer_fils.sql` if it never
ran. That migration takes short table locks on `settlement_batches`,
`merchants` and `ledger_entries`. Follow its own plan in
`docs/solved-problems/009-lifetime-payout-estimate.md` and stop payout
writers first.
