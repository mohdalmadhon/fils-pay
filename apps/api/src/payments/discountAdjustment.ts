import { parseBhdToFils } from "@filspay/money";
import { BadRequestError } from "../lib/errors.js";


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

// applyCaptureDiscountAdjustment used to live here: it charged the full MDR
// at capture and then reversed discount x fee in a separate ledger group,
// only on the API capture route. The discount is now part of the fee
// capture.ts posts (settlementFeeFils), the way settlement computes it.
// Captures made before that change still carry their
// "capture: negotiated discount adjustment" groups. docs/improvements/06.
