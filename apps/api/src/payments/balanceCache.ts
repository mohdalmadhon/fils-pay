import type { PoolClient } from "pg";

/** Call after posting payable legs, in their own transaction. Preserve display
 * corrections on existing rows; initialize a missing row from the whole ledger.
 */
export async function applyPayableCacheDelta(client: PoolClient, merchantId: string, delta: number): Promise<void> {
  const updated = await client.query(
    `UPDATE merchant_balances SET cached_payable_fils = cached_payable_fils + $2, updated_at = now()
      WHERE merchant_id = $1`, [merchantId, delta]);
  if ((updated.rowCount ?? 0) > 0) return;
  // Only the first writer needs a ledger scan. A concurrent first insert
  // is handled by adding this transaction's delta to its initialized row.
  await client.query(
    `INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
     SELECT $1, COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0), now()
       FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
     ON CONFLICT (merchant_id) DO UPDATE
       SET cached_payable_fils = merchant_balances.cached_payable_fils + $2, updated_at = now()`,
    [merchantId, delta],
  );
}
