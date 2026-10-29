import type { Pool } from "pg";
import { ForbiddenError } from "../lib/errors.js";

/**
 * The merchant a report runs for. A caller may report on itself, or on one of
 * its own split children (merchant_split_children.parent_merchant_id is the
 * caller). Any other merchant ID is refused with 403, never silently swapped,
 * so a bad filter is visible to the client.
 */
export async function resolveReportMerchantId(
  pool: Pool,
  callerMerchantId: string,
  requestedMerchantId?: string,
): Promise<string> {
  if (!requestedMerchantId || requestedMerchantId === callerMerchantId) {
    return callerMerchantId;
  }

  const result = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
       FROM merchant_split_children
      WHERE child_merchant_id = $1 AND parent_merchant_id = $2`,
    [requestedMerchantId, callerMerchantId],
  );
  if (result.rows.length === 0) {
    throw new ForbiddenError("forbidden_merchant", "you can only report on your own merchant or its split children");
  }
  return requestedMerchantId;
}
