import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

export interface ArchivedDeliveryEntry {
  deliveryId: string;
  outboxEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateArchiveResult {
  archiveId: string;
  deliveryCount: number;
}

/**
 * Snapshots every delivery for one endpoint in [from, to) into a retained
 * archive, ahead of a URL rotation or the endpoint being disabled. No row
 * cap: an audit archive that silently dropped deliveries past some threshold
 * would defeat the reason it exists.
 *
 * The copy is a single INSERT ... SELECT inside Postgres, one archive entry
 * row per delivery (migration 0077). It used to read every delivery into the
 * API process and JSON.stringify the lot into one text column, so a large
 * range needed the whole history in memory and failed outright past V8's
 * maximum string length or Postgres's 1 GB field limit.
 */
export async function createWebhookDeliveryArchive(
  pool: Pool,
  input: { merchantId: string; endpointId: string; adminUserId: string; from: Date; to: Date },
): Promise<CreateArchiveResult> {
  return withTransaction(pool, async (client) => {
    const endpoint = await client.query<{ id: string }>(
      `SELECT id FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2`,
      [input.endpointId, input.merchantId],
    );
    if (!endpoint.rows[0]) {
      throw new NotFoundError("webhook_endpoint_not_found");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO webhook_delivery_archives
          (endpoint_id, merchant_id, created_by_admin_user_id, from_created_at, to_created_at, delivery_count, archive_payload)
       VALUES ($1, $2, $3, $4, $5, 0, NULL)
       RETURNING id`,
      [input.endpointId, input.merchantId, input.adminUserId, input.from, input.to],
    );
    const archiveId = inserted.rows[0]!.id;

    const copied = await client.query(
      `INSERT INTO webhook_delivery_archive_entries
          (archive_id, seq, delivery_id, outbox_event_id, event_type, payload, delivery_created_at)
       SELECT $1, row_number() OVER (ORDER BY created_at, id), id, outbox_event_id, event_type, payload, created_at
         FROM webhook_deliveries
        WHERE endpoint_id = $2 AND created_at >= $3 AND created_at < $4`,
      [archiveId, input.endpointId, input.from, input.to],
    );
    const deliveryCount = copied.rowCount ?? 0;

    await client.query(`UPDATE webhook_delivery_archives SET delivery_count = $2 WHERE id = $1`, [
      archiveId,
      deliveryCount,
    ]);

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "webhook_delivery_archive_create",
      targetType: "webhook_endpoint",
      targetId: input.endpointId,
      metadata: { merchantId: input.merchantId, deliveryCount },
    });

    return { archiveId, deliveryCount };
  });
}

/**
 * Reads one page of an archive's entries in capture order, for export or
 * inspection without loading the whole archive: pass the last `seq` you saw
 * as `afterSeq` to continue.
 */
export async function readArchiveEntries(
  pool: Pool,
  input: { merchantId: string; archiveId: string; afterSeq?: number; limit?: number },
): Promise<Array<ArchivedDeliveryEntry & { seq: number }>> {
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 1000);
  const result = await pool.query<{
    seq: number;
    delivery_id: string;
    outbox_event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    delivery_created_at: Date;
  }>(
    `SELECT e.seq, e.delivery_id, e.outbox_event_id, e.event_type, e.payload, e.delivery_created_at
       FROM webhook_delivery_archive_entries e
       JOIN webhook_delivery_archives a ON a.id = e.archive_id
      WHERE e.archive_id = $1 AND a.merchant_id = $2 AND e.seq > $3
      ORDER BY e.seq
      LIMIT $4`,
    [input.archiveId, input.merchantId, input.afterSeq ?? 0, limit],
  );
  return result.rows.map((r) => ({
    seq: r.seq,
    deliveryId: r.delivery_id,
    outboxEventId: String(r.outbox_event_id),
    eventType: r.event_type,
    payload: r.payload,
    createdAt: r.delivery_created_at.toISOString(),
  }));
}

/** Deletes admin-created archives older than `retentionDays` (their entries cascade). */
export async function pruneExpiredArchives(
  pool: Pool,
  retentionDays: number,
): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const result = await pool.query(
    `DELETE FROM webhook_delivery_archives
      WHERE created_at < $1
        AND created_by_admin_user_id IS NOT NULL
    RETURNING id`,
    [cutoff],
  );
  return { deletedCount: result.rowCount ?? 0 };
}

/**
 * Bulk-replays every delivery captured in a previously created archive,
 * used to backfill a newly registered replacement endpoint with a merchant's
 * delivery history after a URL rotation, without asking the merchant to
 * re-trigger months of real events. All or nothing, in one transaction.
 */
export async function replayWebhookDeliveryArchive(
  pool: Pool,
  input: { merchantId: string; archiveId: string; targetEndpointId: string; adminUserId: string },
): Promise<{ replayedCount: number }> {
  return withTransaction(pool, async (client) => {
    const archiveResult = await client.query<{ id: string }>(
      `SELECT id FROM webhook_delivery_archives WHERE id = $1 AND merchant_id = $2`,
      [input.archiveId, input.merchantId],
    );
    if (!archiveResult.rows[0]) {
      throw new NotFoundError("webhook_delivery_archive_not_found");
    }

    const targetEndpoint = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2`,
      [input.targetEndpointId, input.merchantId],
    );
    const targetRow = targetEndpoint.rows[0];
    if (!targetRow) {
      throw new NotFoundError("webhook_endpoint_not_found");
    }
    if (targetRow.status !== "active") {
      throw new ConflictError("endpoint_disabled");
    }

    // One statement, inside Postgres: each archived delivery becomes a new
    // pending replay row, exactly as insertReplayDeliveryRow builds one (a
    // fresh delivery_event_id, also written into the envelope's own `id`,
    // and replay_of_delivery_id pointing at the original). It used to
    // JSON.parse the whole archive in the API and insert row by row.
    const replayed = await client.query(
      `WITH src AS (
         SELECT e.seq, e.delivery_id, e.outbox_event_id, e.event_type, e.payload, gen_random_uuid() AS new_event_id
           FROM webhook_delivery_archive_entries e
          WHERE e.archive_id = $1
       )
       INSERT INTO webhook_deliveries
           (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, next_attempt_at, replay_of_delivery_id)
       SELECT $2, src.outbox_event_id, src.event_type, src.new_event_id,
              jsonb_set(src.payload, '{id}', to_jsonb(src.new_event_id::text)), 'pending', now(), src.delivery_id
         FROM src
        ORDER BY src.seq`,
      [input.archiveId, input.targetEndpointId],
    );
    const replayedCount = replayed.rowCount ?? 0;

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "webhook_delivery_archive_replay",
      targetType: "webhook_endpoint",
      targetId: input.targetEndpointId,
      metadata: { merchantId: input.merchantId, archiveId: input.archiveId, replayedCount },
    });

    return { replayedCount };
  });
}
