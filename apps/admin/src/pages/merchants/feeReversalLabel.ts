import type { AdminMerchantDetail } from "../../types.js";

/**
 * Text for the credit form's "reverse the MDR" checkbox. The server
 * (apps/api/src/admin/credits.ts) reverses at the merchant's effective rate
 * today: the current fee schedule's rate (or the base MDR when there is
 * none), less the volume-tier bonus and the negotiated discount. The base
 * `merchant.mdrBps` is only the fallback, so it must not be shown as the
 * rate on its own.
 */
export function feeReversalLabel(detail: Pick<AdminMerchantDetail, "currentFeeSchedule">): string {
  const schedule = detail.currentFeeSchedule;
  if (schedule) {
    return `Also reverse the MDR on this amount, at the current rate (${(schedule.mdrBps / 100).toFixed(2)}% before any volume or negotiated discount)`;
  }
  return "Also reverse the MDR on this amount, at the merchant's current effective rate";
}
