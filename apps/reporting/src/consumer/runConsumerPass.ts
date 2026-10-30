import type { Pool } from "pg";
import type { EventType } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";
import type { ReportingConfig } from "../config.js";
import { readCursor, advanceCursor } from "./cursor.js";
import { applyEvent, type OutboxEventRow } from "./applyEvent.js";

// am: refund.succeeded not here yet. when refunds ship just add it to the list
export const REPORTING_EVENT_TYPES: readonly EventType[] = [
  "transaction.captured",
  "transaction.voided",
  "settlement.batch_closed",
];

/**
 * Keys this worker's row in reporting_outbox_cursor. Two processes using the
 * same name serialize on that row, so a catch-up run beside a live worker
 * cannot apply an event twice.
 */
export const CONSUMER_NAME = "reporting";

/** Apply visible, unreceipted events atomically with their receipts and rollups.
 * A lower ID that commits later is still eligible. The cursor is retained as
 * the largest observed ID and a freshness signal, not an eligibility cutoff.
 */
export async function runConsumerPass(
  pool: Pool,
  config: Pick<ReportingConfig, "consumerBatchLimit">,
): Promise<{ processedCount: number }> {
  return withTransaction(pool, async (client) => {
    const cursor = await readCursor(client, CONSUMER_NAME);

    // Receipts, not sequence allocation order, establish application progress.
    const eventsResult = await client.query<OutboxEventRow>(
      `SELECT id, event_type, aggregate_id, payload, created_at
         FROM outbox_events
        WHERE NOT EXISTS (SELECT 1 FROM reporting_processed_events done
          WHERE done.consumer_name = $1 AND done.outbox_event_id = outbox_events.id)
          AND event_type = ANY($2::text[])
        ORDER BY id ASC
        LIMIT $3`,
      [CONSUMER_NAME, REPORTING_EVENT_TYPES, config.consumerBatchLimit],
    );

    // FH: redundant with ORDER BY id ASC (last row is max). harmless
    let maxId = cursor.lastProcessedId;
    let processedCount = 0;
    for (const row of eventsResult.rows) {
      const claimed = await client.query(
        `INSERT INTO reporting_processed_events (consumer_name, outbox_event_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING outbox_event_id`,
        [CONSUMER_NAME, row.id.toString()],
      );
      if (!claimed.rows[0]) continue;
      await applyEvent(client, row);
      processedCount += 1;
      const rowId = BigInt(row.id);
      if (rowId > maxId) maxId = rowId;
    }

    if (eventsResult.rows.length > 0) {
      await advanceCursor(client, CONSUMER_NAME, maxId);
    }

    return { processedCount };
  });
}
