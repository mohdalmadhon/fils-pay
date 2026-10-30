/**
 * The ledger balance trigger (check_ledger_group_balance, 0007, replaced in
 * 0087) must check every group a statement touches. Before the fix an
 * UPDATE that moved a leg out of a group only checked the group it moved
 * into (NEW.entry_group_id), so the group it left could be left unbalanced.
 * docs/bugs/084-ledger-check-misses-group-a-leg-left.md.
 *
 * Runs in a transaction that is rolled back. SET CONSTRAINTS ... IMMEDIATE
 * runs the deferred checks at that point instead of at commit. Requires
 * DATABASE_URL pointing at a migrated database.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test db/ledgerGroupBalance.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("ledgerGroupBalance.integration.test.ts requires DATABASE_URL");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

async function withRollback(fn: (client: PoolClient, merchantId: string) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const m = (
      await client.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
        `Ledger Balance ${randomUUID()}`,
      ])
    ).rows[0]!.id;
    await fn(client, m);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

const leg = (client: PoolClient, m: string, group: string, account: string, direction: string, amount: number) =>
  client.query<{ id: string }>(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [group, m, account, direction, amount],
  );

test("moving a leg out of a group is refused when it leaves that group unbalanced", async () => {
  await withRollback(async (client, m) => {
    const a = randomUUID();
    const b = randomUUID();
    await leg(client, m, a, "card_scheme_clearing", "debit", 100);
    const credit = await leg(client, m, a, "merchant_payable", "credit", 100);
    await client.query(`SET CONSTRAINTS ledger_entries_balance IMMEDIATE`);
    await client.query(`SET CONSTRAINTS ledger_entries_balance DEFERRED`);

    // Move A's credit leg into a new group B and give B a matching debit:
    // B balances, A is left with a lone 100 fils debit.
    await client.query(`UPDATE ledger_entries SET entry_group_id = $1 WHERE id = $2`, [b, credit.rows[0]!.id]);
    await leg(client, m, b, "card_scheme_clearing", "debit", 100);

    await assert.rejects(
      client.query(`SET CONSTRAINTS ledger_entries_balance IMMEDIATE`),
      new RegExp(`ledger_entries group ${a} does not balance: net 100 fils`),
    );
  });
});

test("an UPDATE that keeps both groups balanced is still allowed", async () => {
  await withRollback(async (client, m) => {
    const a = randomUUID();
    const b = randomUUID();
    const d = await leg(client, m, a, "card_scheme_clearing", "debit", 100);
    const c = await leg(client, m, a, "merchant_payable", "credit", 100);
    await client.query(`SET CONSTRAINTS ledger_entries_balance IMMEDIATE`);
    await client.query(`SET CONSTRAINTS ledger_entries_balance DEFERRED`);
    await client.query(`UPDATE ledger_entries SET entry_group_id = $1 WHERE id = ANY($2::bigint[])`, [
      b,
      [d.rows[0]!.id, c.rows[0]!.id],
    ]);
    await client.query(`SET CONSTRAINTS ledger_entries_balance IMMEDIATE`);
  });
});
