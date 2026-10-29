/**
 * Report scope: a merchant may report on itself, or on one of its own split
 * children, and on nothing else.
 *
 * Before the fix, any merchant could name any split child (of any parent) in
 * the report filter and read its transactions.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("scope.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => {
  await pool.end();
});

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Report Scope Test ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function makeChild(parent: string, child: string): Promise<void> {
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent, child],
  );
}

test("a merchant reports on itself by default", async () => {
  const m = await createMerchant();
  assert.equal(await resolveReportMerchantId(pool, m), m);
  assert.equal(await resolveReportMerchantId(pool, m, m), m);
});

test("a parent may report on its own split child", async () => {
  const parent = await createMerchant();
  const child = await createMerchant();
  await makeChild(parent, child);
  assert.equal(await resolveReportMerchantId(pool, parent, child), child);
});

test("a merchant may not report on another parent's split child", async () => {
  const otherParent = await createMerchant();
  const child = await createMerchant();
  await makeChild(otherParent, child);
  const attacker = await createMerchant();
  await assert.rejects(
    resolveReportMerchantId(pool, attacker, child),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
});

test("naming an unrelated merchant is refused, not silently ignored", async () => {
  const caller = await createMerchant();
  const stranger = await createMerchant();
  await assert.rejects(
    resolveReportMerchantId(pool, caller, stranger),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
});
