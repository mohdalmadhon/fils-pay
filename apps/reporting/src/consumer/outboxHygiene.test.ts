/**
 * Explains the most common cause of a failing reporting suite instead of
 * leaving a bare NOT NULL error: an outbox event of a type reporting applies,
 * without a merchantId. Real producers (capture.ts, void.ts, CloseBatch)
 * always set it, so such a row comes from a test or a hand-written INSERT.
 * One of them blocks every consumer pass (by design: a pass is all-or-nothing,
 * see runConsumerPass.ts), so the rest of this suite would fail too.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { REPORTING_EVENT_TYPES } from "./runConsumerPass.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("outboxHygiene.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
test.after(async () => {
  await pool.end();
});

test("no unprocessed reporting event in the outbox is missing its merchantId", async () => {
  const result = await pool.query<{ event_type: string; n: string; first_id: string }>(
    `SELECT e.event_type, count(*)::text AS n, min(e.id)::text AS first_id
       FROM outbox_events e
      WHERE e.event_type = ANY($1::text[])
        AND (e.payload->>'merchantId') IS NULL
        AND e.id > COALESCE((SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = 'reporting'), 0)
      GROUP BY e.event_type`,
    [REPORTING_EVENT_TYPES],
  );
  assert.deepEqual(
    result.rows,
    [],
    "malformed outbox events will block every reporting pass; see docs/RUNBOOK.md, " +
      "'Dashboards stopped updating: a malformed outbox event'",
  );
});
