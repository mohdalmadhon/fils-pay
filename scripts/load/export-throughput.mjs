#!/usr/bin/env node
/**
 * Payments captured per second during a load or crash test, read from the
 * database itself (the source of truth, not what the load tool believes),
 * as CSV for scripts/load/report-html.mjs. Read-only.
 *
 *   DATABASE_URL=postgres://... node scripts/load/export-throughput.mjs <from ISO> [to ISO] > tps.csv
 *
 * Columns: time (ISO, whole second), captured (capture events that second),
 * linksPaid (payment links marked paid that second).
 */
import pg from "pg";

const [from, to = new Date().toISOString()] = process.argv.slice(2);
if (!from) {
  console.error("usage: export-throughput.mjs <from ISO> [to ISO]");
  process.exit(2);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query(
  `WITH seconds AS (
     SELECT generate_series(date_trunc('second', $1::timestamptz), date_trunc('second', $2::timestamptz), interval '1 second') AS s
   )
   SELECT to_char(s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time,
          (SELECT count(*) FROM transaction_events te
            WHERE te.event_type IN ('captured', 'partially_captured')
              AND te.occurred_at >= s AND te.occurred_at < s + interval '1 second')::int AS captured,
          (SELECT count(*) FROM payment_links pl
            WHERE pl.paid_at >= s AND pl.paid_at < s + interval '1 second')::int AS links_paid
     FROM seconds ORDER BY s`,
  [from, to],
);
console.log("time,captured,linksPaid");
for (const row of result.rows) console.log(`${row.time},${row.captured},${row.links_paid}`);
await client.end();
