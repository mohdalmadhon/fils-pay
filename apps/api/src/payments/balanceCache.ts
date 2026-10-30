import type { PoolClient } from "pg";
import { onBeforeCommit, transactionLocal } from "../db/withTransaction.js";

/** Call after posting payable legs, in their own transaction. Preserve display
 * corrections on existing rows; initialize a missing row from the whole ledger.
 */
export async function applyPayableCacheDelta(client: PoolClient, merchantId: string, delta: number): Promise<void> {
  // Every capture for a merchant updates this one row, and the update locks
  // it until COMMIT. Applied here, mid-transaction, the lock was held through
  // the rest of checkout's transaction, so a merchant's checkouts queued on
  // it one at a time: on one vCPU each update waited ~0.5 s and checkout
  // topped out near 22/s. The change is now added up and applied as the
  // transaction's last statement (withTransaction's onBeforeCommit); same
  // transaction, same result, far shorter lock. Outside withTransaction it
  // is applied at once, as before. docs/perf/checkout-capacity.md.
  const pending = transactionLocal(client, PENDING, () => {
    const totals = new Map<string, number>();
    onBeforeCommit(client, async () => {
      // A fixed order, so two transactions never wait on each other's rows.
      for (const [id, total] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        await writePayableCacheDelta(client, id, total);
      }
    });
    return totals;
  });
  if (!pending) return writePayableCacheDelta(client, merchantId, delta);
  pending.set(merchantId, (pending.get(merchantId) ?? 0) + delta);
}

const PENDING = Symbol("pending payable cache deltas");

async function writePayableCacheDelta(client: PoolClient, merchantId: string, delta: number): Promise<void> {
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
