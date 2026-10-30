import { Pool } from "pg";
import type { Config } from "../config.js";
import { formatIsoDate } from "../lib/dateFormat.js";

/**
 * Creates the single shared `pg.Pool` for the process. 20 connections by
 * default (PG_POOL_MAX). It was 5, sized for a 0.5 vCPU container on the
 * idea that the process couldn't use more; but checkout holds a connection
 * while the acquirer answers, mostly idle, so 5 capped the API at about 10
 * checkouts a second with the CPU nowhere near busy. On one vCPU, 20
 * reaches the CPU's limit and 40 is no faster (docs/perf/checkout-capacity.md).
 * Keep API + settlement + reporting pools under Postgres's max_connections
 * (100 by default).
 *
 * This should be created once in `index.ts` and never per-request.
 */
export function createPool(config: Config): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    idleTimeoutMillis: config.pgPoolIdleTimeoutMs,
    connectionTimeoutMillis: config.pgPoolConnectionTimeoutMs,
  });

  // `pg` emits 'error' on the pool when an idle client's connection dies
  // (DB restart, failover, network blip). With no listener, Node treats
  // this as an unhandled error and crashes the whole process. Logging it
  // here lets `pg` internally drop/replace the bad client instead of
  // taking the API down.
  // The pool listens for errors only on idle connections. A connection
  // checked out for a transaction that is waiting on something else (checkout
  // waits on the acquirer with its transaction open) has no listener, so
  // when Postgres went away mid-wait, pg emitted 'error' on it unhandled
  // and the whole API exited (found by the crash test,
  // docs/perf/checkout-capacity.md). With a listener the transaction's
  // next query fails, it rolls back, and the API stays up.
  pool.on("connect", (client) => {
    client.on("error", (err) => {
      console.error("[pg pool] connection lost while checked out", { date: formatIsoDate(new Date()), message: err.message });
    });
  });
  pool.on("error", (err) => {
    console.error("[pg pool] unexpected error on idle client", { date: formatIsoDate(new Date()), err });
  });

  if (process.env.LOG_LEVEL === "debug") {
    const origQuery = pool.query.bind(pool) as Pool["query"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any).query = function debugQuery(...args: any[]) {
      const queryText = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "<unknown>";
      const paramCount = Array.isArray(args[1]) ? (args[1] as unknown[]).length : 0;
      console.log(
        `[pg debug] ${formatIsoDate(new Date())} query=${queryText.slice(0, 120).replace(/\s+/g, " ")} params=${paramCount}`,
      );
      return (origQuery as Function).apply(pool, args);
    };
  }

  return pool;
}
