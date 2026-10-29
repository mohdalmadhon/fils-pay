/**
 * Regression tests for the slow merchant dashboard queries.
 *
 *  - recent-ledger-activity filtered on `(occurred_at AT TIME ZONE ...)::date`,
 *    which no index can serve, so every ledger row of the merchant was read.
 *  - the breakdown filtered on transactions.created_at, which had no index,
 *    so it seq-scanned every merchant's transactions.
 *
 * The plan checks capture the exact SQL each function sends and EXPLAIN it
 * with sequential scans disabled. That makes them independent of table size:
 * they ask "can an index serve this predicate", which is what was wrong.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool, type QueryResult } from "pg";
import { getBreakdown, getRecentLedgerActivity } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("queryPlans.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

/** A Pool stand-in that records the queries it is given, then runs them. */
function recordingPool() {
  const seen: Array<{ text: string; values: unknown[] }> = [];
  const fake = {
    query(text: string, values: unknown[]): Promise<QueryResult> {
      seen.push({ text, values });
      return pool.query(text, values);
    },
  } as unknown as Pool;
  return { fake, seen };
}

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Filter?: string;
  Plans?: PlanNode[];
}

function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

async function planWithoutSeqScan(text: string, values: unknown[]): Promise<PlanNode[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    await client.query("SET LOCAL enable_bitmapscan = off");
    const r = await client.query<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(`EXPLAIN (FORMAT JSON) ${text}`, values);
    return nodes(r.rows[0]!["QUERY PLAN"][0]!.Plan);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function merchant(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Plans ${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

/** A balanced pair of ledger legs at `occurredAt`; returns the payable leg's id. */
async function ledgerAt(merchantId: string, occurredAt: string): Promise<string> {
  const r = await pool.query<{ id: string; account_id: string }>(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'card_scheme_clearing', 'debit', 100, $3, 'plan test'),
            ($1, $2, 'merchant_payable', 'credit', 100, $3, 'plan test')
     RETURNING id, account_id`,
    [randomUUID(), merchantId, occurredAt],
  );
  return r.rows.find((row) => row.account_id === "merchant_payable")!.id;
}

test("recent ledger activity: Bahrain day edges are unchanged (from and to inclusive)", async () => {
  const m = await merchant();
  const before = await ledgerAt(m, "2025-12-31T23:59:59+03:00");
  const first = await ledgerAt(m, "2026-01-01T00:00:00+03:00"); // 21:00 UTC on 31 Dec
  const last = await ledgerAt(m, "2026-01-31T23:59:59+03:00");
  const after = await ledgerAt(m, "2026-02-01T00:00:00+03:00");

  const res = await getRecentLedgerActivity(pool, { merchantId: m, from: "2026-01-01", to: "2026-01-31" });
  const ids = new Set(res.points.map((p) => p.id));
  assert.ok(ids.has(first) && ids.has(last), "both edge days are included");
  assert.ok(!ids.has(before) && !ids.has(after), "the days either side are not");
});

test("recent ledger activity: the date range is an index condition, not a per-row filter", async () => {
  const m = await merchant();
  const { fake, seen } = recordingPool();
  await getRecentLedgerActivity(fake, { merchantId: m, from: "2026-01-01", to: "2026-01-31" });
  const plan = await planWithoutSeqScan(seen[0]!.text, seen[0]!.values);

  const scan = plan.find((n) => n["Index Name"] === "idx_ledger_entries_merchant_occurred");
  assert.ok(scan, `expected idx_ledger_entries_merchant_occurred, got ${plan.map((n) => n["Node Type"]).join(", ")}`);
  assert.match(scan["Index Cond"] ?? "", /occurred_at/, "occurred_at must be bounded by the index");
  assert.doesNotMatch(scan.Filter ?? "", /occurred_at/, "occurred_at must not be filtered row by row");
});

test("analytics breakdown: the created_at range is served by an index", async () => {
  const m = await merchant();
  const { fake, seen } = recordingPool();
  await getBreakdown(fake, { merchantId: m, from: "2026-01-01", to: "2026-02-01", groupBy: "status" });
  const plan = await planWithoutSeqScan(seen[0]!.text, seen[0]!.values);

  const scan = plan.find((n) => (n["Index Cond"] ?? "").includes("created_at"));
  assert.ok(
    scan,
    `created_at must be an index condition; plan: ${JSON.stringify(plan.map((n) => [n["Node Type"], n["Index Name"], n.Filter]))}`,
  );
});
