-- Read-only report: transactions whose refunds gave back more MDR fee than
-- the merchant paid.
--
-- Until the fix in apps/api/src/payments/processRefund.ts, a refund reversed
-- its share of the *gross* MDR credited at capture, ignoring the negotiated
-- discount already debited back to the merchant, so merchants with a
-- discount were credited the discounted part twice. Separately rounded
-- partial refunds could also add up to more than the fee.
--
-- net_fee_charged_fils: MDR credited at capture minus discount adjustments.
-- fee_reversed_fils:    what refunds credited back to the merchant.
-- over_reversed_fils:   the excess, owed back by the merchant (or written off).
--
--   psql "$DATABASE_URL" -f db/reports/refund-fee-over-reversal.sql

WITH fee AS (
  SELECT transaction_id,
         SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) AS net_fee_charged_fils
    FROM ledger_entries
   WHERE account_id = 'platform_fee_revenue'
     AND transaction_id IS NOT NULL
     AND description IS DISTINCT FROM 'refund: MDR fee reversal'
   GROUP BY transaction_id
),
rev AS (
  SELECT transaction_id, merchant_id, SUM(fee_reversed_fils) AS fee_reversed_fils, count(*) AS refunds
    FROM refunds
   WHERE status = 'succeeded'
   GROUP BY transaction_id, merchant_id
)
SELECT rev.merchant_id,
       rev.transaction_id,
       rev.refunds,
       GREATEST(COALESCE(fee.net_fee_charged_fils, 0), 0) AS net_fee_charged_fils,
       rev.fee_reversed_fils,
       rev.fee_reversed_fils - GREATEST(COALESCE(fee.net_fee_charged_fils, 0), 0) AS over_reversed_fils
  FROM rev
  LEFT JOIN fee ON fee.transaction_id = rev.transaction_id
 WHERE rev.fee_reversed_fils > GREATEST(COALESCE(fee.net_fee_charged_fils, 0), 0)
 ORDER BY over_reversed_fils DESC;
