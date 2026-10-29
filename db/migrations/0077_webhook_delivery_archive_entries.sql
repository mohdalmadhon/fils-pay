-- Webhook delivery archives, one row per archived delivery.
--
-- 0068 stored a whole archive as ONE text value: every delivery in the range,
-- serialized by the API into a single JSON string in memory, written in one
-- INSERT, and read back and JSON.parse'd in full to restore it. Nothing was
-- paged or compressed, though ADMIN.md and the comment at the end of 0068
-- say "archives are built in 1000-row pages and stored compressed". A large
-- range (a busy endpoint over months) needs the whole history in the API
-- process's memory twice over. It fails once the string passes V8's maximum
-- string length (~512 MB) or Postgres's 1 GB field limit, and gets slow and
-- memory-hungry long before that.
--
-- Entries now live here, one row each, written and replayed by single
-- INSERT ... SELECT statements inside Postgres, so the API never holds an
-- archive in memory. archive_payload becomes optional: new archives leave it
-- NULL. Existing archives are copied into this table so they can still be
-- restored; their original text is kept untouched.

CREATE TABLE webhook_delivery_archive_entries (
    archive_id           UUID NOT NULL REFERENCES webhook_delivery_archives (id) ON DELETE CASCADE,
    seq                  INTEGER NOT NULL,            -- capture order, 1-based
    delivery_id          UUID NOT NULL,
    outbox_event_id      BIGINT NOT NULL,
    event_type           TEXT NOT NULL,
    payload              JSONB NOT NULL,
    delivery_created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (archive_id, seq)
);

ALTER TABLE webhook_delivery_archives ALTER COLUMN archive_payload DROP NOT NULL;

INSERT INTO webhook_delivery_archive_entries
       (archive_id, seq, delivery_id, outbox_event_id, event_type, payload, delivery_created_at)
SELECT a.id,
       e.ordinality::int,
       (e.value ->> 'deliveryId')::uuid,
       (e.value ->> 'outboxEventId')::bigint,
       e.value ->> 'eventType',
       e.value -> 'payload',
       (e.value ->> 'createdAt')::timestamptz
  FROM webhook_delivery_archives a
 CROSS JOIN LATERAL jsonb_array_elements(a.archive_payload::jsonb) WITH ORDINALITY AS e(value, ordinality)
 WHERE a.archive_payload IS NOT NULL;
