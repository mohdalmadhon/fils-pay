-- Read-only report: split settlement payouts whose child shares did not add
-- up to the batch's net payout.
--
-- Until the fix in apps/settlement/internal/splits, each child's share was
-- rounded on its own, so the shares summed to a few fils less (or more) than
-- the batch paid out, and the difference stayed in (or was taken from) the
-- parent merchant's payable balance.
--
-- difference_fils > 0: fils that never reached any child (still owed).
-- difference_fils < 0: fils paid to children beyond the batch's net payout.
--
--   psql "$DATABASE_URL" -f db/reports/split-payout-shortfall.sql

SELECT sb.merchant_id          AS parent_merchant_id,
       sb.id                   AS settlement_batch_id,
       sb.batch_date,
       sb.net_payout_fils,
       COALESCE(SUM(s.allocated_fils), 0) AS allocated_fils,
       sb.net_payout_fils - COALESCE(SUM(s.allocated_fils), 0) AS difference_fils,
       count(s.*)              AS children
  FROM settlement_batches sb
  JOIN settlement_batch_splits s ON s.settlement_batch_id = sb.id
 WHERE sb.status = 'paid'
 GROUP BY sb.id
HAVING sb.net_payout_fils > 0 AND sb.net_payout_fils <> COALESCE(SUM(s.allocated_fils), 0)
 ORDER BY sb.batch_date, sb.merchant_id;

-- Per parent, the running total:
-- SELECT parent_merchant_id, sum(difference_fils) FROM (<query above>) q GROUP BY 1;
