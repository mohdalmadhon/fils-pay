import type { Pool } from "pg";

/**
 * Operational record of a payout-rail instruction for a settlement batch.
 *
 * Exactly one record per batch, however many times this runs. The dispatcher
 * calls it before the first attempt of every settlement.paid delivery: once
 * per merchant endpoint, again for a replayed delivery, and (before migration
 * 0075) once more for every duplicate outbox event (incident 2026-08-21). The
 * partial unique index uq_settlement_payout_disbursements_batch makes every
 * call after the first a no-op, including two calls racing each other.
 *
 * Returns true only when this call wrote the record.
 */
export async function recordPayoutDisbursementEffect(
  pool: Pool,
  settlementBatchId: string,
  amountFils: number,
): Promise<boolean> {
  if (amountFils <= 0) {
    // Void batches (zero or negative net) carry no payout instruction.
    return false;
  }

  const result = await pool.query(
    `INSERT INTO settlement_payout_disbursements (settlement_batch_id, amount_fils, disbursement_reference)
     VALUES ($1, $2, 'disb_' || gen_random_uuid())
     ON CONFLICT (settlement_batch_id) WHERE duplicate_of IS NULL DO NOTHING`,
    [settlementBatchId, amountFils],
  );
  return (result.rowCount ?? 0) > 0;
}
