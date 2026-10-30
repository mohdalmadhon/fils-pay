import type { Pool, PoolClient } from "pg";

/**
 * Checks out a client from `pool`, runs `fn` inside a `BEGIN`/`COMMIT`
 * transaction, and rolls back on any error — always releasing the client
 * back to the pool. This is the standard way to perform a multi-statement
 * atomic write (e.g. signup, KYC review recording) anywhere in this
 * codebase; a bare pool query is only for single-statement reads/writes
 * that don't need atomicity with anything else.
 */
// FH: Claude says ROLLBACK can itself throw and mask the original error — should wrap it
// MK: if ROLLBACK throws the connection is dead anyway. release() still runs. fine
// am: release() on a dead client should pass the err so pg destroys it? release(err)
// YA: pg handles it on the next query. leave
// FH 2026-07-28: noticed fn can call pool.query instead of client.query by mistake and it silently
// runs outside the transaction. grep found none today
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  /*
   * Isolation level is the Postgres default (READ COMMITTED). Callers that
   * need to serialise on a row take an explicit SELECT ... FOR UPDATE inside
   * fn; nothing here upgrades the level.
   */
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope: TransactionScope = { hooks: [], locals: new Map() };
    scopes.set(client, scope);
    try {
      const result = await fn(client);
      // Work registered with onBeforeCommit runs last, still inside the
      // transaction, so it commits or rolls back with everything else.
      for (const hook of scope.hooks) await hook();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      // Commit or rollback: this transaction's hooks and state go with it,
      // never into the pooled connection's next transaction.
      scopes.delete(client);
    }
  } finally {
    client.release();
  }
}

interface TransactionScope {
  hooks: Array<() => Promise<void>>;
  locals: Map<symbol, unknown>;
}

const scopes = new WeakMap<PoolClient, TransactionScope>();

/**
 * Runs `hook` as the last step of the transaction `client` is in, just
 * before COMMIT, and returns true; or returns false when `client` isn't in
 * a withTransaction transaction (the caller should then do the work at
 * once). For writes to rows many transactions contend for, so their lock
 * is held only for the last statement and the commit
 * (payments/balanceCache.ts, docs/perf/checkout-capacity.md).
 */
export function onBeforeCommit(client: PoolClient, hook: () => Promise<void>): boolean {
  const scope = scopes.get(client);
  if (!scope) return false;
  scope.hooks.push(hook);
  return true;
}

/**
 * State that lives exactly as long as the transaction `client` is in:
 * created by `init` on first use, dropped at commit or rollback. Undefined
 * when `client` isn't in a withTransaction transaction.
 */
export function transactionLocal<T>(client: PoolClient, key: symbol, init: () => T): T | undefined {
  const scope = scopes.get(client);
  if (!scope) return undefined;
  if (!scope.locals.has(key)) scope.locals.set(key, init());
  return scope.locals.get(key) as T;
}
