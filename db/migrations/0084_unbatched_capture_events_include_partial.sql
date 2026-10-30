-- v_unbatched_capture_events (0054) listed only event_type = 'captured', so
-- partial captures that are still waiting for a batch were missing from it.
-- CloseBatch (apps/settlement/internal/settlement/batch.go) settles both
-- 'captured' and 'partially_captured' events, so the view now does too.
-- Same columns, same order, so CREATE OR REPLACE is enough.
CREATE OR REPLACE VIEW v_unbatched_capture_events AS
SELECT te.id AS event_id,
       te.transaction_id,
       te.event_type,
       te.amount_fils,
       te.created_at,
       t.merchant_id
  FROM transaction_events te
  JOIN transactions t ON t.id = te.transaction_id
 WHERE te.event_type IN ('captured', 'partially_captured')
   AND te.settlement_batch_id IS NULL;
