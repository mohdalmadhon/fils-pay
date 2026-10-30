/**
 * The fee settlement will charge on one capture event, computed exactly the
 * way apps/settlement's CloseBatch computes it, so the API can say what a
 * not-yet-batched capture will pay out without waiting for the batch.
 *
 * Mirrors, in integer fils with half-to-even rounding (applyRateFils):
 *   - EffectiveMdrBpsAt (internal/settlement/fee_schedule.go): the newest
 *     fee_schedules row whose effective_from has arrived by the capture,
 *     else the merchant's own mdr_bps;
 *   - minus the platform volume-tier bonus, floored at 0;
 *   - ComputeSettlementFee (internal/settlement/discounted_fee.go): the
 *     negotiated discount reduces the amount the MDR is charged on.
 */
import { applyRateFils, toFils } from "@filspay/money";

export interface FeeScheduleRow {
  effectiveFrom: Date;
  createdAt: Date;
  mdrBps: number;
}

/** The rate in effect at `asOf`: newest effective_from not after it, a later
 *  created_at winning a tie (same rule as getEffectiveMdrBps); otherwise the
 *  fallback (merchants.mdr_bps). */
export function effectiveMdrBpsAt(schedules: readonly FeeScheduleRow[], asOf: Date, fallbackMdrBps: number): number {
  let best: FeeScheduleRow | null = null;
  for (const row of schedules) {
    if (row.effectiveFrom.getTime() > asOf.getTime()) continue;
    if (
      !best ||
      row.effectiveFrom.getTime() > best.effectiveFrom.getTime() ||
      (row.effectiveFrom.getTime() === best.effectiveFrom.getTime() && row.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = row;
    }
  }
  return best ? best.mdrBps : fallbackMdrBps;
}

/** ComputeSettlementFee: fee on (amount minus the discount share), integer fils. */
export function settlementFeeFils(amountFils: number, mdrBps: number, discountBps: number): number {
  const amount = toFils(amountFils);
  const discounted = Number(amount) - Number(applyRateFils(amount, discountBps));
  return Number(applyRateFils(toFils(discounted), Math.max(0, mdrBps)));
}
