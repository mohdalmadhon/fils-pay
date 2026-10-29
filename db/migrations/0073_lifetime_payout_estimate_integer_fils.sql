-- Deployment plan and DBA review: docs/solved-problems/009-lifetime-payout-estimate.md.
-- Stop payout writers before applying; the migration runner wraps this in
-- one transaction. Lock before reading history so no payout is lost or doubled.
LOCK TABLE settlement_batches IN ACCESS EXCLUSIVE MODE;
LOCK TABLE merchants IN ACCESS EXCLUSIVE MODE;
LOCK TABLE ledger_entries IN SHARE MODE;

-- Do not cast the old REAL value: it has already lost precision (and may
-- contain seeded closed-but-unpaid totals). Rebuild from actual ordinary
-- PayoutBatch debit legs, counting one side of each balanced payout only.
-- Preserve this counter's existing scope: split payouts have never updated it.
ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT USING 0::BIGINT,
    ALTER COLUMN lifetime_net_payout_monitoring_estimate SET DEFAULT 0;

UPDATE merchants AS m
   SET lifetime_net_payout_monitoring_estimate = totals.paid_fils
  FROM (
      SELECT merchant_id, SUM(amount_fils)::BIGINT AS paid_fils
        FROM ledger_entries
       WHERE account_id = 'merchant_payable'
         AND direction = 'debit'
         AND settlement_batch_id IS NOT NULL
         AND description = 'settlement payout: batch paid'
       GROUP BY merchant_id
  ) AS totals
 WHERE m.id = totals.merchant_id;

COMMENT ON COLUMN merchants.lifetime_net_payout_monitoring_estimate IS
    'Exact integer fils paid through ordinary PayoutBatch; monitoring only, excludes split payouts';
