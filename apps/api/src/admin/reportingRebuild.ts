import type { PoolClient } from "pg";

/** Counts of outbox_events replayed into each rollup table. */
export interface RebuildAnalyticsSummary {
  volumeRows: number;
  trendRows: number;
}

/** Truncates and repopulates the two rollup tables
 *  (merchant_daily_volume, merchant_payout_trends) from source. */
export async function refreshAnalyticsRollups(client: PoolClient): Promise<RebuildAnalyticsSummary> {
  // Same lock order as the worker: cursor before rollups. Block event
  // producers while source aggregates and receipts are captured, so a commit
  // cannot appear between those snapshots and be acknowledged without totals.
  await client.query(`INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id)
    VALUES ('reporting', 0) ON CONFLICT DO NOTHING`);
  await client.query(`SELECT last_processed_id FROM reporting_outbox_cursor
    WHERE consumer_name = 'reporting' FOR UPDATE`);
  await client.query(`LOCK TABLE outbox_events IN SHARE MODE`);
  // YA: ACCESS EXCLUSIVE lock is fine while analytics is internal only (Jan 2026)
  await client.query(`TRUNCATE merchant_daily_volume`);
  await client.query(`TRUNCATE merchant_payout_trends`);

  const trendResult = await client.query(
    `INSERT INTO merchant_payout_trends
        (merchant_id, settlement_batch_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at, last_updated_at)
     SELECT merchant_id, id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at, now()
       FROM settlement_batches`,
  );

  const volumeResult = await client.query(
    `INSERT INTO merchant_daily_volume
        (merchant_id, volume_date, captured_count, captured_gross_fils, voided_count, last_updated_at)
     SELECT t.merchant_id,
            (te.occurred_at AT TIME ZONE 'Asia/Bahrain')::date,
            COUNT(*) FILTER (WHERE te.event_type IN ('captured', 'partially_captured')),
            COALESCE(SUM(te.amount_fils) FILTER (WHERE te.event_type IN ('captured', 'partially_captured')), 0),
            COUNT(*) FILTER (WHERE te.event_type = 'voided'),
            now()
       FROM transaction_events te
       JOIN transactions t ON t.id = te.transaction_id
      WHERE te.event_type IN ('captured', 'partially_captured', 'voided')
      GROUP BY t.merchant_id, (te.occurred_at AT TIME ZONE 'Asia/Bahrain')::date`,
  );

  await client.query(`INSERT INTO reporting_processed_events (consumer_name, outbox_event_id)
    SELECT 'reporting', id FROM outbox_events ON CONFLICT DO NOTHING`);
  await client.query(`UPDATE reporting_outbox_cursor
    SET last_processed_id = COALESCE((SELECT MAX(id) FROM outbox_events), 0), updated_at = now()
    WHERE consumer_name = 'reporting'`);

  return { volumeRows: volumeResult.rowCount ?? 0, trendRows: trendResult.rowCount ?? 0 };
}
