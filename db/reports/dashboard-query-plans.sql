-- Operator check: do the merchant dashboard's live queries use their indexes?
--
-- Run after deploying migration 0076 (and any time a dashboard feels slow).
-- Set :merchant to a busy merchant's id. Expected plans:
--   1. recent ledger activity -> Index Scan (Backward) using
--      idx_ledger_entries_merchant_occurred, with occurred_at in the Index Cond
--   2. analytics breakdown    -> Index Scan / Bitmap Index Scan using
--      idx_transactions_merchant_created
-- A "Seq Scan" or a large "Rows Removed by Filter" means a regression.
--
--   psql "$DATABASE_URL" -v merchant="'<merchant uuid>'" -f db/reports/dashboard-query-plans.sql

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, account_id, direction, amount_fils, occurred_at, description
  FROM ledger_entries
 WHERE merchant_id = :merchant
   AND occurred_at >= ((current_date - 7)::timestamp AT TIME ZONE 'Asia/Bahrain')
   AND occurred_at <  ((current_date + 1)::timestamp AT TIME ZONE 'Asia/Bahrain')
 ORDER BY occurred_at DESC
 LIMIT 200;

EXPLAIN (ANALYZE, BUFFERS)
SELECT t.status AS grp, COUNT(*), COALESCE(SUM(amount_fils), 0)
  FROM transactions t
 WHERE t.merchant_id = :merchant
   AND t.created_at >= now() - interval '7 days' AND t.created_at < now()
 GROUP BY t.status;
