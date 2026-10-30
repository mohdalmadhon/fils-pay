import type { PaymentLinkDto, PaymentLinkStatus } from "../../types.js";

/** What the dashboard shows for a link. `expired` is never stored (see
 *  migration 0020): a link stays `active` in the database after its
 *  `expiresAt` passes, so the page works it out from the time. */
export type DisplayedLinkStatus = PaymentLinkStatus | "expired";

export function displayedLinkStatus(
  link: Pick<PaymentLinkDto, "status" | "expiresAt">,
  now: Date = new Date(),
): DisplayedLinkStatus {
  if (link.status === "active" && Date.parse(link.expiresAt) <= now.getTime()) return "expired";
  return link.status;
}

/** Only a link that is active and not yet expired can be cancelled. */
export function canCancelLink(link: Pick<PaymentLinkDto, "status" | "expiresAt">, now: Date = new Date()): boolean {
  return displayedLinkStatus(link, now) === "active";
}
