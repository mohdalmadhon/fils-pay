-- Incident 2026-08-21: duplicate "your payout is on the way" notifications.
--
-- EnqueuePayoutNotifications (apps/settlement) decided "this batch has no
-- settlement.paid event yet" with a NOT EXISTS read and then inserted in a
-- separate statement. Nothing stopped two runs (the daemon's tick and a
-- manual `run-batch`, or two daemon replicas) from both passing the read and
-- both inserting, so a batch got two settlement.paid outbox rows, two
-- webhook deliveries and two disbursement records. A comment in that file
-- claimed outbox_events had a unique index on (event_type, aggregate_id).
-- It never did (see 0009).
--
-- Fix: let the database enforce "one" in both places.
--
--   1. At most one live settlement.paid outbox event per settlement batch.
--   2. At most one live payout disbursement record per settlement batch
--      (0057 says "one row per paid batch"; nothing enforced it).
--
-- Historical duplicates can't simply be deleted: webhook_deliveries
-- references outbox_events, and the duplicate disbursement rows are the
-- record of what actually happened. They are marked as superseded by the
-- earliest row of their group instead, and the unique indexes only cover
-- rows that are not superseded.

-- 1. settlement.paid outbox events -------------------------------------------

ALTER TABLE outbox_events
    ADD COLUMN superseded_by BIGINT REFERENCES outbox_events (id);

COMMENT ON COLUMN outbox_events.superseded_by IS
    'Set on a duplicate event that should never have been enqueued; points at the event that is kept. Superseded events get no new webhook deliveries.';

UPDATE outbox_events oe
   SET superseded_by = ranked.keep_id
  FROM (
    SELECT id,
           first_value(id) OVER w AS keep_id,
           row_number() OVER w AS rn
      FROM outbox_events
     WHERE event_type = 'settlement.paid'
    WINDOW w AS (PARTITION BY aggregate_id ORDER BY created_at, id)
  ) ranked
 WHERE oe.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX uq_outbox_settlement_paid_per_batch
    ON outbox_events (aggregate_id)
 WHERE event_type = 'settlement.paid' AND superseded_by IS NULL;

-- 2. payout disbursement records ---------------------------------------------

ALTER TABLE settlement_payout_disbursements
    ADD COLUMN duplicate_of UUID REFERENCES settlement_payout_disbursements (id);

COMMENT ON COLUMN settlement_payout_disbursements.duplicate_of IS
    'Set on a disbursement record written a second time for the same batch (incident 2026-08-21); points at the record that is kept. Reconcile these with the payout rail.';

UPDATE settlement_payout_disbursements d
   SET duplicate_of = ranked.keep_id
  FROM (
    SELECT id,
           first_value(id) OVER w AS keep_id,
           row_number() OVER w AS rn
      FROM settlement_payout_disbursements
    WINDOW w AS (PARTITION BY settlement_batch_id ORDER BY created_at, id)
  ) ranked
 WHERE d.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id)
 WHERE duplicate_of IS NULL;
