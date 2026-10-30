import type { Pool } from "pg";
import { derivePublicStatus } from "./status.js";

interface PublicPaymentLinkRow {
  token: string;
  amount_fils: string | number;
  currency: string;
  reference: string | null;
  description: string | null;
  status: string;
  expires_at: Date;
  reserved_at: Date | null;
  merchant_display_name: string;
  merchant_status: string;
}

/** Public shape. Contains nothing that identifies or authenticates the merchant beyond its display name. */
export interface PublicPaymentLinkDto {
  token: string;
  amountFils: number;
  currency: string;
  merchantDisplayName: string;
  reference: string | null;
  description: string | null;
  status: string;
  expiresAt: string;
}

/** `GET /v1/payment-links/:token` — public, unauthenticated. */
export async function getPublicPaymentLink(
  pool: Pool,
  token: string,
  reservationTimeoutSeconds: number,
): Promise<PublicPaymentLinkDto | null> {
  // This route is public: it must never select anything from api_keys. It
  // used to return the newest live key's prefix ("merchantPublicKey") and its
  // sha256 verifier ("merchantIntegrationId"). See docs/cyper/11.
  const result = await pool.query<PublicPaymentLinkRow>(
    `SELECT pl.token, pl.amount_fils, pl.currency, pl.reference, pl.description,
            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name,
            m.status AS merchant_status
       FROM payment_links pl
       JOIN merchants m ON m.id = pl.merchant_id
      WHERE pl.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    token: row.token,
    amountFils: Number(row.amount_fils),
    currency: row.currency,
    merchantDisplayName: row.merchant_display_name,
    reference: row.reference,
    description: row.description,
    // YA: same helper as pay.ts so the two never disagree. correct
    status: derivePublicStatus(
      {
        status: row.status,
        expiresAt: row.expires_at,
        reservedAt: row.reserved_at,
        merchantStatus: row.merchant_status,
      },
      reservationTimeoutSeconds,
    ),
    expiresAt: row.expires_at.toISOString(),
  };
}
