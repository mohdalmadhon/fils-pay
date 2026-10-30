import { ZERO_FILS, compareFils, type Fils } from "@filspay/money";

/** The subset of a `transactions` row a refund decision depends on. */
export interface RefundableTransaction {
  id: string;
  merchantId: string;
  status: string;
  capturedFils: Fils;
  refundableFils: Fils;
}

export type RefundValidation =
  | { ok: true; amountFils: Fils }
  | { ok: false; code: "transaction_not_refundable"; status: string }
  | { ok: false; code: "refund_amount_invalid" }
  | { ok: false; code: "refund_exceeds_refundable"; refundableFils: Fils };

const REFUNDABLE_STATUSES = new Set(["captured", "partially_captured", "partially_refunded"]);

/** How much this transaction may still return. */
export function refundableAmount(txn: RefundableTransaction): Fils {
  return txn.refundableFils;
}

/** Decides whether `requestedAmountFils` may be refunded against `txn`. */
export function validateRefundRequest(
  txn: RefundableTransaction,
  requestedAmountFils?: Fils,
): RefundValidation {
  if (!REFUNDABLE_STATUSES.has(txn.status)) {
    return { ok: false, code: "transaction_not_refundable", status: txn.status };
  }

  if (compareFils(txn.capturedFils, ZERO_FILS) === 0) {
    return { ok: false, code: "transaction_not_refundable", status: txn.status };
  }

  const refundable = refundableAmount(txn);
  // Nothing left to return and no amount given ("refund the rest"). A
  // partial capture whose captured part was all refunded keeps
  // 'partially_captured' (refundState.ts), so the status check above lets it
  // through, and the default amount of 0 used to come back as "bad amount"
  // (422 refund_amount_invalid) although the caller sent no amount. It gets
  // the same answer as a 'refunded' one. An explicit amount still gets
  // refund_exceeds_refundable with the ceiling of 0. docs/bugs/007.
  if (requestedAmountFils === undefined && compareFils(refundable, ZERO_FILS) <= 0) {
    return { ok: false, code: "transaction_not_refundable", status: txn.status };
  }
  const requested = requestedAmountFils ?? refundable;

  if (compareFils(requested, ZERO_FILS) <= 0) {
    return { ok: false, code: "refund_amount_invalid" };
  }
  if (compareFils(requested, refundable) > 0) {
    return { ok: false, code: "refund_exceeds_refundable", refundableFils: refundable };
  }

  return { ok: true, amountFils: requested };
}
