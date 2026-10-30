#!/usr/bin/env node
/**
 * After a load or crash test: checks from the database itself that no money
 * was lost, doubled or left half-done (docs/perf/checkout-capacity.md).
 * Read-only. Run on the server (or anywhere that reaches its database):
 *
 *   DATABASE_URL=postgres://... node scripts/load/verify-db.mjs --baseline   (before the test)
 *   DATABASE_URL=postgres://... node scripts/load/verify-db.mjs [since]      (after it)
 *
 * `since` (ISO time, default: the last 6 hours) limits the payment checks
 * to links created by the test. Exit 0 when every check holds.
 *
 *   ledger balances       every ledger entry group nets to zero
 *   paid links            each paid link has exactly one captured
 *                         transaction for its full amount
 *   no stray captures     no captured link payment without its link
 *                         marked paid (a buyer charged but told "failed")
 *   no double charges     no link with more than one captured transaction
 *   balance cache         each merchant's cached payable moved exactly as
 *                         its ledger did since --baseline (display-only
 *                         corrections, ADR 0006, are a deliberate standing
 *                         difference, so the difference must not change)
 *   capture events        every captured link payment has its capture
 *                         event and its outbox event (webhooks, reporting)
 *   stuck reservations    links still "reserved" past the timeout, which
 *                         the next buyer can take over (reported, not
 *                         failed: a crash mid-payment leaves these)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const BASELINE = "scripts/out/cache-baseline.json";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

/** Per merchant: cached payable minus the ledger's payable. */
async function cacheDrift() {
  const r = await client.query(
    `SELECT mb.merchant_id::text AS id, (mb.cached_payable_fils - COALESCE(l.payable, 0))::text AS drift
       FROM merchant_balances mb
       LEFT JOIN (SELECT merchant_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) AS payable
                    FROM ledger_entries WHERE account_id = 'merchant_payable' GROUP BY merchant_id) l
         ON l.merchant_id = mb.merchant_id`,
  );
  return Object.fromEntries(r.rows.map((row) => [row.id, row.drift]));
}

if (process.argv[2] === "--baseline") {
  mkdirSync("scripts/out", { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), drift: await cacheDrift() }));
  console.log(`saved ${BASELINE}; run the test, then run this again without --baseline`);
  await client.end();
  process.exit(0);
}

const since = process.argv[2] ?? new Date(Date.now() - 6 * 3_600_000).toISOString();

const checks = [
  {
    name: "ledger balances",
    sql: `SELECT count(*) AS bad FROM (
            SELECT entry_group_id FROM ledger_entries
             GROUP BY entry_group_id
            HAVING SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) <> 0) g`,
  },
  {
    name: "paid links have one full capture",
    sql: `SELECT count(*) AS bad FROM payment_links pl
            LEFT JOIN transactions t ON t.id = pl.transaction_id
           WHERE pl.created_at >= $1 AND pl.status = 'paid'
             AND (t.id IS NULL OR t.status <> 'captured' OR t.captured_fils <> pl.amount_fils)`,
  },
  {
    name: "no stray captures (charged, link not paid)",
    // A link payment's authorize key is "paylink:<link id>:...": a captured
    // transaction from one must belong to a link that says paid with it.
    sql: `SELECT count(*) AS bad FROM transactions t
            JOIN idempotency_keys k ON k.merchant_id = t.merchant_id AND k.key LIKE 'paylink:%:authorize'
                                   AND (k.response_body->>'id')::uuid = t.id
            JOIN payment_links pl ON pl.id = split_part(k.key, ':', 2)::uuid
           WHERE pl.created_at >= $1 AND k.created_at >= $1 AND t.status IN ('captured', 'partially_captured')
             AND (pl.status <> 'paid' OR pl.transaction_id <> t.id)`,
  },
  {
    name: "no double charges",
    sql: `SELECT count(*) AS bad FROM (
            SELECT split_part(k.key, ':', 2) AS link_id FROM idempotency_keys k
              JOIN transactions t ON t.id = (k.response_body->>'id')::uuid
             WHERE k.key LIKE 'paylink:%:authorize' AND k.created_at >= $1
               AND t.status IN ('captured', 'partially_captured')
             GROUP BY 1 HAVING count(*) > 1) d`,
  },
  {
    name: "captures have their event and outbox row",
    sql: `SELECT count(*) AS bad FROM payment_links pl
           WHERE pl.created_at >= $1 AND pl.status = 'paid'
             AND (NOT EXISTS (SELECT 1 FROM transaction_events e WHERE e.transaction_id = pl.transaction_id AND e.event_type = 'captured')
               OR NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate_id = pl.transaction_id AND o.event_type = 'transaction.captured'))`,
  },
];

let failed = 0;
for (const check of checks) {
  const r = await client.query(check.sql, check.sql.includes("$1") ? [since] : []);
  const bad = Number(r.rows[0].bad);
  if (bad > 0) failed += 1;
  console.log(`${bad === 0 ? "PASS" : "FAIL"}  ${check.name}${bad ? `: ${bad}` : ""}`);
}

if (existsSync(BASELINE)) {
  const before = JSON.parse(readFileSync(BASELINE, "utf8")).drift;
  const now = await cacheDrift();
  const moved = Object.keys(now).filter((id) => (before[id] ?? "0") !== now[id]);
  if (moved.length > 0) failed += 1;
  console.log(`${moved.length === 0 ? "PASS" : "FAIL"}  balance cache moved with the ledger${moved.length ? `: ${moved.length} merchants drifted` : ""}`);
} else {
  console.log("SKIP  balance cache (run with --baseline before the test)");
}

const summary = await client.query(
  `SELECT count(*) FILTER (WHERE status = 'paid') AS paid,
          count(*) FILTER (WHERE status = 'active') AS active,
          count(*) FILTER (WHERE status = 'reserved') AS reserved,
          count(*) FILTER (WHERE status = 'reserved' AND reserved_at < now() - interval '60 seconds') AS stale
     FROM payment_links WHERE created_at >= $1`,
  [since],
);
const s = summary.rows[0];
console.log(`links since ${since}: ${s.paid} paid, ${s.active} unpaid, ${s.reserved} reserved (${s.stale} past the 60 s timeout, free for the next buyer)`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
