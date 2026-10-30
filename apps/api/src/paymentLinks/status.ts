/**
 * Derived public status for a payment link, for GET /v1/payment-links/:token
 * (read.ts). The pay endpoint (pay.ts, classifyClaimFailure) does not call
 * this: it classifies a refused claim from its own query, including the
 * merchant check. Keep the two in step; paymentLinkSuspendedMerchant.test.ts
 * covers both for a suspended merchant.
 *
 * Deliberately narrower than the stored `payment_links.status` enum: a
 * customer-facing checkout page never needs to distinguish a live 'active'
 * link from one whose reservation has already self-expired back to
 * claimable — both are simply 'active' from the outside. A merchant-facing
 * list (query.ts) uses the raw stored status instead, since a dashboard
 * operator does benefit from seeing "a payment is currently in flight" as
 * its own filterable state.
 */
export type PublicPaymentLinkStatus = "active" | "processing" | "paid" | "expired" | "canceled" | "unavailable";

/** reservedAt null on a 'reserved' row is treated as epoch, i.e. immediately claimable again. */
export interface PaymentLinkStatusInput {
  status: string;
  expiresAt: Date;
  reservedAt: Date | null;
  /**
   * merchants.status. Anything but 'active' (suspended, closed) makes an
   * unpaid link 'unavailable', matching pay.ts, which refuses it with
   * 409 merchant_unavailable. Omitted means active.
   */
  merchantStatus?: string;
}

// FH: uses Date.now() not the client time — should this use expiryReferenceTime too?
// MK: no. public status is server time. (and yes that means read/pay can disagree, known)
export function derivePublicStatus(
  row: PaymentLinkStatusInput,
  reservationTimeoutSeconds: number,
): PublicPaymentLinkStatus {
  if (row.status === "paid") return "paid";
  if (row.status === "canceled") return "canceled";
  const base = derivePaymentState(row, reservationTimeoutSeconds);
  // A suspended or closed merchant can't take a new payment. A payment
  // already in flight ('processing') may still complete, so it is reported
  // as it is rather than as "nothing was taken".
  if (base !== "processing" && row.merchantStatus !== undefined && row.merchantStatus !== "active") {
    return "unavailable";
  }
  return base;
}

function derivePaymentState(
  row: PaymentLinkStatusInput,
  reservationTimeoutSeconds: number,
): "active" | "expired" | "processing" {
  if (row.status === "active") {
    return row.expiresAt.getTime() <= Date.now() ? "expired" : "active";
  }

  // row.status === 'reserved'
  const reservedAtMs = row.reservedAt?.getTime() ?? 0;
  const stillReserved = reservedAtMs > Date.now() - reservationTimeoutSeconds * 1000;
  if (stillReserved) return "processing";
  return row.expiresAt.getTime() <= Date.now() ? "expired" : "active";
}
