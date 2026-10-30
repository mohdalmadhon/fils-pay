import type { PoolClient } from "pg";
import { toFils } from "@filspay/money";
import { nextStatusAfterRefund } from "../payments/refundState.js";

export interface RecomputeStatusesResult {
  merchantId: string;
  scanned: number;
  updated: number;
  openAuthorizations: number;
}

/** BIGINT columns arrive as text and are converted with toFils. */
interface CandidateRow {
  id: string;
  status: string;
  amount_fils: string;
  captured_fils: string;
  refunded_fils: string;
}

/** Backfill transaction statuses from amounts for one merchant. */
export async function recomputeTransactionStatusesForMerchant(
  client: PoolClient,
  merchantId: string,
): Promise<RecomputeStatusesResult> {
  const candidates = await client.query<CandidateRow>(
    `SELECT id, status, amount_fils, captured_fils, refunded_fils
       FROM transactions
      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided')
      FOR UPDATE`,
    [merchantId],
  );

  const changes: Array<{ id: string; status: string }> = [];

  for (const row of candidates.rows) {
    const next = nextStatusAfterRefund({
      amountFils: toFils(Number(row.amount_fils)),
      capturedFils: toFils(Number(row.captured_fils)),
      refundedTotalFils: toFils(Number(row.refunded_fils)),
    });
    if (next !== row.status) {
      changes.push({ id: row.id, status: next });
    }
  }

  // Keep the existing JS status/money rules and candidate row locks. Send
  // changed rows together in bounded batches instead of one UPDATE per row.
  const BATCH_SIZE = 500;
  for (let offset = 0; offset < changes.length; offset += BATCH_SIZE) {
    const batch = changes.slice(offset, offset + BATCH_SIZE);
    await client.query(
      `UPDATE transactions AS transaction
          SET status = change.status
         FROM unnest($1::uuid[], $2::text[]) AS change(id, status)
        WHERE transaction.id = change.id`,
      [batch.map((row) => row.id), batch.map((row) => row.status)],
    );
  }

  // Authorized transactions are deliberately not candidates above (nothing
  // to re-derive until they are captured or voided), so they have to be
  // counted separately. Counting them inside the loop always gave 0.
  const open = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM transactions WHERE merchant_id = $1 AND status = 'authorized'`,
    [merchantId],
  );
  const openAuthorizations = Number(open.rows[0]?.n ?? 0);

  return { merchantId, scanned: candidates.rows.length, updated: changes.length, openAuthorizations };
}
