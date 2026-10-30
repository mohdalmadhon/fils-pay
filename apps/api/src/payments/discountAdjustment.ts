import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { applyRateFils, parseBhdToFils, toFils } from "@filspay/money";
import { withTransaction } from "../db/withTransaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";


/**
 * Parses a promotional discount amount (BD string from the merchant
 * pricing dashboard) into fils for the ledger adjustment. 1 BD = 1000 fils.
 * (This used parseFloat and multiplied by 100, i.e. cents, the same mistake
 * the adjustment importer made.)
 */
export function parsePromotionalDiscountFils(raw: string): number {
  let fils: number;
  try {
    fils = parseBhdToFils(raw);
  } catch {
    throw new BadRequestError("invalid_discount", `could not parse discount amount "${raw}"`);
  }
  if (fils < 0) {
    throw new BadRequestError("invalid_discount", `could not parse discount amount "${raw}"`);
  }
  return fils;
}

/** Adjust each capture event once, including zero-value discounts.
 * The event marker and balanced legs commit together under the transaction lock.
 * Unmapped legacy adjustments are deliberately blocked instead of guessed.
 */
export async function applyCaptureDiscountAdjustment(
  pool: Pool,
  input: { merchantId: string; transactionId: string },
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const owned = await client.query(
      `SELECT id FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [input.transactionId, input.merchantId],
    );
    if (!owned.rows[0]) throw new NotFoundError("transaction_not_found");
    const events = await client.query<{ id: string; metadata: { feeFils?: number; negotiatedDiscountBps?: number } }>(
      `SELECT id, metadata FROM transaction_events
        WHERE transaction_id = $1 AND event_type IN ('captured', 'partially_captured')
          AND NOT (metadata ? 'negotiatedDiscountAppliedFils')
        ORDER BY id FOR UPDATE`, [input.transactionId],
    );
    if (events.rows.length === 0) return;
    const legacy = await client.query(
      `SELECT 1 FROM ledger_entries WHERE transaction_id = $1
        AND description = 'capture: negotiated discount adjustment'
        AND NOT EXISTS (SELECT 1 FROM transaction_events
          WHERE transaction_id = $1 AND metadata ? 'negotiatedDiscountAppliedFils') LIMIT 1`,
      [input.transactionId],
    );
    if (legacy.rows[0] || events.rows.some(e => e.metadata.negotiatedDiscountBps === undefined)) {
      throw new ConflictError("legacy_discount_review_required", "Capture history needs finance review before discount replay");
    }
    for (const event of events.rows) {
      const fee = toFils(event.metadata.feeFils ?? 0);
      const discountFils = applyRateFils(fee, event.metadata.negotiatedDiscountBps!);
      if (discountFils > 0) {
        await client.query(
          `INSERT INTO ledger_entries
             (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
           VALUES
             ($1, $2, $3, 'platform_fee_revenue', 'debit', $4, now(), 'capture: negotiated discount adjustment'),
             ($1, $2, $3, 'merchant_payable', 'credit', $4, now(), 'capture: negotiated discount adjustment')`,
          [randomUUID(), input.merchantId, input.transactionId, discountFils],
        );
      }
      await client.query(
        `UPDATE transaction_events SET metadata = metadata || jsonb_build_object('negotiatedDiscountAppliedFils', $2::bigint)
          WHERE id = $1`, [event.id, discountFils],
      );
    }
  });
}
