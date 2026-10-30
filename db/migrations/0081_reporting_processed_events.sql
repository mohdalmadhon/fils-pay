-- Pause reporting/catch-up/rebuild processes during migration and deployment.
-- Keep existing rollups: bootstrap only rows presumed consumed by the old
-- watermark. Previously missed committed history needs an explicit rebuild.
CREATE TABLE reporting_processed_events (
    consumer_name TEXT NOT NULL REFERENCES reporting_outbox_cursor(consumer_name) ON DELETE CASCADE,
    outbox_event_id BIGINT NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, outbox_event_id)
);
INSERT INTO reporting_processed_events (consumer_name, outbox_event_id)
SELECT c.consumer_name, oe.id
  FROM reporting_outbox_cursor c JOIN outbox_events oe ON oe.id <= c.last_processed_id;
