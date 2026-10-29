-- Acquirer callback redelivery dedupe.
--
-- The acquirer re-sends a callback (same callback_id, same transaction)
-- when our acknowledgement is slow. 0051 deliberately left callback_id
-- unconstrained and the "processed_events" table that was supposed to dedupe
-- redeliveries was never created, so every redelivery saved another
-- identical note against the payment.
--
-- The dedupe key is (transaction_id, callback_id): a redelivery always
-- repeats both. A different callback for the same payment, or the same
-- callback_id seen on a different payment, is not a redelivery and is kept.
--
-- Existing duplicates are collapsed first (the unique index cannot be built
-- while they exist), keeping the earliest-received row of each group.

DELETE FROM acquirer_callback_notes n
 USING (
   SELECT id,
          row_number() OVER (
            PARTITION BY transaction_id, callback_id
            ORDER BY created_at, id
          ) AS rn
     FROM acquirer_callback_notes
 ) ranked
 WHERE n.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX uq_acquirer_callback_notes_transaction_callback
    ON acquirer_callback_notes (transaction_id, callback_id);
