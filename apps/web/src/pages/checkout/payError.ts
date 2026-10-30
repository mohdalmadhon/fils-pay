/**
 * What the checkout page tells the customer when POST /v1/payment-links/:token/pay
 * fails. Pure, so it is tested without rendering (payError.test.ts).
 *
 * `retryable: false` ends the flow (no card form); `true` keeps the form so
 * the customer can try again.
 */
export interface PayFailure {
  kind: "declined" | "terminal";
  message: string;
  /** A card decline: shakes the card preview. */
  countsAsDecline: boolean;
}

export function describePayFailure(statusCode: number, body: { error?: string; stage?: string; message?: string }): PayFailure {
  if (statusCode === 402) {
    const message =
      body.stage === "capture"
        ? "Your card was approved but the payment couldn't be completed. No payment was taken. Try again."
        : "Your card was declined. Try another card, or contact your bank.";
    return { kind: "declined", message, countsAsDecline: true };
  }
  if (statusCode === 502) {
    return {
      kind: "declined",
      message: "The card network didn't respond. No payment was taken. Try again in a moment.",
      countsAsDecline: true,
    };
  }
  if (statusCode === 409 && body.error === "payment_link_already_paid") {
    return { kind: "terminal", message: "This invoice has already been paid.", countsAsDecline: false };
  }
  if (statusCode === 409 && body.error === "payment_link_canceled") {
    return { kind: "terminal", message: "This payment link is no longer available.", countsAsDecline: false };
  }
  // Suspended or closed merchant. Before docs/improvements/16 this fell into
  // the generic 409 below and told the customer to wait and refresh.
  if (statusCode === 409 && body.error === "merchant_unavailable") {
    return {
      kind: "terminal",
      message: "This business can't accept payments at the moment. No payment was taken.",
      countsAsDecline: false,
    };
  }
  if (statusCode === 409) {
    return {
      kind: "declined",
      message: "Someone is paying this link right now. Wait a moment, then refresh the page.",
      countsAsDecline: false,
    };
  }
  if (statusCode === 410) {
    return { kind: "terminal", message: "This payment link has expired.", countsAsDecline: false };
  }
  return { kind: "declined", message: body.message ?? "The payment didn't go through. Try again.", countsAsDecline: false };
}
