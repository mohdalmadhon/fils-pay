import type { Pool } from "pg";
import { ForbiddenError } from "../lib/errors.js";
import { canonicalMerchantId } from "../auth/throttle.js";

/**
 * The merchant a report runs for. A caller may report on itself, or on one of
 * its own split children (merchant_split_children.parent_merchant_id is the
 * caller). Any other merchant ID is refused with 403, never silently swapped,
 * so a bad filter is visible to the client.
 */
export async function resolveReportMerchantId(
  pool: Pool,
  callerMerchantId: string,
  rawRequestedMerchantId?: unknown,
): Promise<string> {
  if (rawRequestedMerchantId === undefined || rawRequestedMerchantId === null || rawRequestedMerchantId === "") {
    return callerMerchantId;
  }
  // The filter is client JSON: compare in the canonical spelling, and refuse
  // anything that isn't a UUID before it reaches SQL.
  const requestedMerchantId = canonicalMerchantId(rawRequestedMerchantId);
  if (!requestedMerchantId) {
    throw new ForbiddenError("forbidden_merchant", "you can only report on your own merchant or its split children");
  }
  if (requestedMerchantId === callerMerchantId.toLowerCase()) {
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
