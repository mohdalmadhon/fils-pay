# Fix report: suspiciously slow reporting queries

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium (performance). Two live dashboard queries couldn't use an index. One read every ledger row the merchant had ever written; the other read **every merchant's** transactions on each load. Both got steadily slower over time. |
| **Component** | `apps/api/src/analytics/query.ts`, `db/migrations/0076` |
| **Reported** | "One of the reporting queries is suspiciously slow." |
| **Date** | 2026-10-29 |

## Summary

**1. Recent ledger activity** (`GET /v1/analytics/recent-ledger-activity`, a
"live" widget that reads `ledger_entries` directly):

```sql
WHERE merchant_id = $1
  AND (occurred_at AT TIME ZONE 'Asia/Bahrain')::date BETWEEN $2::date AND $3::date
```

Wrapping `occurred_at` in an expression means the
`(merchant_id, occurred_at)` index can only narrow by merchant. Every one of
the merchant's ledger rows was read and converted, and nearly all of them
thrown away. Ledger rows only ever accumulate, so this got slower every day.

**2. Analytics breakdown** (`getBreakdown`) filters transactions on
`(merchant_id, created_at)`. The only per-merchant transactions index is on
`occurred_at` (0017), so Postgres used a **sequential scan of the whole
transactions table**, every merchant's rows.

Measured on the test database:

| Query | Rows | Before | After |
|---|---|---|---|
| Recent ledger activity, 1 week | 300k ledger rows for one merchant | 143 ms, 268 321 rows removed by filter | **0.13 ms**, index range scan |
| Breakdown, 1 week | 300k transactions | 31 ms, parallel seq scan | **1.2 ms**, index scan |

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `analytics: let the recent ledger activity query use its index` | Compares `occurred_at` with two instants: Bahrain midnight at the start of `from`, and Bahrain midnight after `to`. The semantics are the same (both days inclusive). Checked: the old and new queries return the identical 3 360 rows. |
| 2 | `db: index transactions by merchant and created_at for the analytics breakdown` | Migration `0076`: `idx_transactions_merchant_created (merchant_id, created_at)`. |
| 3 | `db: operator check that the dashboard queries use their indexes` | `db/reports/dashboard-query-plans.sql`: `EXPLAIN ANALYZE` of both queries for a given merchant, with the plans to expect. |
| 4 | `test: dashboard queries keep using their indexes` | `analytics/queryPlans.test.ts`. It captures the exact SQL each function sends and `EXPLAIN`s it with seq scans off, asserting the date range is an **index condition**. It also pins the Bahrain day edges. |
| 5 | `docs: slow dashboard queries fix report` | This report. |

## Verification

- `queryPlans.test.ts`: 3/3 pass. With the old query and no 0076 index, both
  plan tests fail. The day-edges test passes on both, which shows the results
  didn't change.
- `routes/analytics.test.ts`: 12/12 pass.
- The plans in the table above came from `EXPLAIN ANALYZE` in the test
  database before and after.

## Deploying

Run `npm run migrate` (0076). On a large production `transactions` table,
consider building the index by hand first with
`CREATE INDEX CONCURRENTLY idx_transactions_merchant_created ON transactions
(merchant_id, created_at);` so the table isn't locked, then let 0076 run.
Then run `db/reports/dashboard-query-plans.sql` against a busy merchant.

## Related, not changed here

- `admin/reportingRebuild.ts` groups by `(occurred_at AT TIME ZONE …)::date`.
  It's a full rebuild that reads everything anyway, so that's fine.
