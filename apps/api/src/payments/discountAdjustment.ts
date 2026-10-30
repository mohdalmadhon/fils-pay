import { settlementFeeFils } from "../fees/settlementFee.js";
import { applyPayableCacheDelta } from "./balanceCache.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
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
  await withTransaction(pool, (client) => applyCaptureDiscountAdjustmentWithClient(client, input));
}

interface CaptureDiscountAdjustment {
  captureEventId: string;
  feeBeforeDiscountFils: number;
  feeFils: number;
}

/** Use the caller's transaction so checkout commits its discount with capture.
 * Results identify only the events adjusted by this call. Their original fee
 * remains available for callers preparing a net-fee timeline/outbox snapshot.
 */
export async function applyCaptureDiscountAdjustmentWithClient(
  client: PoolClient,
  input: { merchantId: string; transactionId: string },
): Promise<CaptureDiscountAdjustment[]> {
  const owned = await client.query(
    `SELECT id FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
    [input.transactionId, input.merchantId],
  );
  if (!owned.rows[0]) throw new NotFoundError("transaction_not_found");
  const events = await client.query<{ id: string; amount_fils: string; metadata: { feeFils?: number; negotiatedDiscountBps?: number; chargedMdrBps?: number } }>(
    `SELECT id, amount_fils, metadata FROM transaction_events
      WHERE transaction_id = $1 AND event_type IN ('captured', 'partially_captured')
        AND NOT (metadata ? 'negotiatedDiscountAppliedFils')
      ORDER BY id FOR UPDATE`, [input.transactionId],
  );
  if (events.rows.length === 0) return [];
  const legacy = await client.query(
    `SELECT 1 FROM ledger_entries WHERE transaction_id = $1
      AND description = 'capture: negotiated discount adjustment'
      AND (SELECT count(*) FROM ledger_entries
        WHERE transaction_id = $1 AND direction = 'credit'
          AND description = 'capture: negotiated discount adjustment') >
        (SELECT count(*) FROM transaction_events WHERE transaction_id = $1
          AND (metadata->>'negotiatedDiscountAppliedFils')::bigint > 0) LIMIT 1`,
    [input.transactionId],
  );
  if (legacy.rows[0]) {
    throw new ConflictError("legacy_discount_review_required", "Capture history needs finance review before discount replay");
  }
  const merchant = await client.query<{ negotiated_discount_bps: number }>(
    `SELECT negotiated_discount_bps FROM merchants WHERE id = $1`, [input.merchantId]);
  const adjustments: CaptureDiscountAdjustment[] = [];
  for (const event of events.rows) {
    const fee = toFils(event.metadata.feeFils ?? 0);
    // Keep the established settlement rule: round the discounted gross, then MDR.
    const hasSnapshot = event.metadata.chargedMdrBps !== undefined && event.metadata.negotiatedDiscountBps !== undefined;
    // Preserve the previous fee-discount contract for unadjusted old captures.
    // Never guess which event an already-posted legacy credit belongs to.
    const discountFils = hasSnapshot
      ? toFils(fee - settlementFeeFils(Number(event.amount_fils), event.metadata.chargedMdrBps!, event.metadata.negotiatedDiscountBps!))
      : applyRateFils(fee, merchant.rows[0]?.negotiated_discount_bps ?? 0);
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
    if (discountFils > 0) await applyPayableCacheDelta(client, input.merchantId, discountFils);
    await client.query(
      `UPDATE transaction_events SET metadata = metadata || jsonb_build_object('negotiatedDiscountAppliedFils', $2::bigint, 'discountPricingSource', $3::text)
        WHERE id = $1`, [event.id, discountFils, hasSnapshot ? "capture-snapshot" : "legacy-fee-discount"],
    );
    adjustments.push({
      captureEventId: event.id,
      feeBeforeDiscountFils: fee,
      feeFils: toFils(fee - discountFils),
    });
  }
  return adjustments;
}
