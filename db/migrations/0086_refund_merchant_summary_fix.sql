-- Recreates refund_merchant_summary (0072), which was always empty.
-- docs/bugs/083-refund-merchant-summary-always-empty.md.
--
-- 0072 joined `transactions t ON t.id = r.id`: a refund's own id is never a
-- transaction id, so no row ever matched. The join must use
-- r.transaction_id. And with that join, SUM(t.captured_fils) would count a
-- transaction once per refund (two refunds of a 10.000 BD payment on one
-- day would show 20.000 BD captured), so the captured total is summed over
-- the distinct transactions refunded that day instead.
--
-- Same columns and unique index as before. Nothing refreshes this view yet
-- (0072's comment said the reporting worker does; it does not), so it holds
-- data only after a manual REFRESH MATERIALIZED VIEW.

DROP MATERIALIZED VIEW IF EXISTS refund_merchant_summary;

CREATE MATERIALIZED VIEW refund_merchant_summary AS
WITH succeeded AS (
    SELECT r.merchant_id,
           r.transaction_id,
           r.amount_fils,
           r.fee_reversed_fils,
           date_trunc('day', r.occurred_at AT TIME ZONE 'Asia/Bahrain') AS business_date
      FROM refunds r
     WHERE r.status = 'succeeded'
),
per_day AS (
    SELECT merchant_id,
           business_date,
           COUNT(*)               AS refund_count,
           SUM(amount_fils)       AS total_refunded_fils,
           SUM(fee_reversed_fils) AS total_fee_reversed_fils
      FROM succeeded
  GROUP BY merchant_id, business_date
),
captured_per_day AS (
    SELECT d.merchant_id,
           d.business_date,
           SUM(t.captured_fils) AS original_captured_fils
      FROM (SELECT DISTINCT merchant_id, business_date, transaction_id FROM succeeded) d
      JOIN transactions t ON t.id = d.transaction_id
  GROUP BY d.merchant_id, d.business_date
)
SELECT p.merchant_id,
       p.business_date,
       p.refund_count,
       p.total_refunded_fils,
       p.total_fee_reversed_fils,
       c.original_captured_fils
  FROM per_day p
  JOIN captured_per_day c USING (merchant_id, business_date);

CREATE UNIQUE INDEX idx_refund_merchant_summary_pk
    ON refund_merchant_summary (merchant_id, business_date);
