/**
 * runMarchSweep against real rows in a throwaway database: it must find the
 * March captures with a residue, preview without posting, post one balanced
 * group per merchant with --apply, and recognise its own earlier posting.
 *
 * Before the fix this file never called runMarchSweep: it filled its own
 * temp table and checked that three ways of computing `% 10` agreed, so it
 * passed whatever the sweep did. docs/bugs/087-tests-that-cannot-fail.md.
 *
 * The month window is UTC (monthBounds). Whether it should be the Bahrain
 * month is an open decision, so the rows here stay clear of the month edges.
 *
 * Requires DATABASE_URL pointing at a Postgres server where the role may
 * CREATE DATABASE; the database in DATABASE_URL is only used to connect.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { marchSweepGroupId, runMarchSweep } from "./reconcile_march.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconcile_march.integration.test.ts requires DATABASE_URL (a role that may CREATE DATABASE)");
}
const here = dirname(fileURLToPath(import.meta.url));
const scratchName = `fp_march_sweep_check_${process.pid}`;

test("runMarchSweep previews, posts once per merchant, then reports already_applied", { timeout: 180_000 }, async () => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.query(`CREATE DATABASE ${scratchName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${scratchName}`;
  try {
    execFileSync("npx", ["tsx", join(here, "..", "db", "migrate.ts")], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: "utf8",
    });
    const db = new Client({ connectionString: url.toString() });
    await db.connect();
    try {
      const merchant = async (name: string) =>
        (await db.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [name]))
          .rows[0]!.id;
      const a = await merchant("Sweep A");
      const b = await merchant("Sweep B");
      const c = await merchant("Sweep C");
      const capture = (m: string, fils: number, at: string) =>
        db.query(
          `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
           VALUES ($1, 'captured', $2, $2, gen_random_uuid()::text, $3)`,
          [m, fils, at],
        );
      await capture(a, 4_759, "2026-03-05T10:00:00Z"); // residue 9
      await capture(a, 1_003, "2026-03-20T10:00:00Z"); // residue 3
      await capture(a, 4_750, "2026-03-21T10:00:00Z"); // no residue
      await capture(b, 2_001, "2026-03-15T10:00:00Z"); // residue 1
      await capture(b, 7_777, "2026-02-15T10:00:00Z"); // February: outside
      await capture(c, 5_555, "2026-04-15T10:00:00Z"); // April: outside

      const preview = await runMarchSweep(db);
      assert.equal(preview.mode, "dry-run");
      assert.deepEqual(preview.blocked, []);
      const summary = (report: typeof preview) =>
        report.merchants
          .map((m) => ({ merchantId: m.merchantId, lineCount: m.lineCount, residueFils: m.residueFils, outcome: m.outcome }))
          .sort((x, y) => x.residueFils - y.residueFils);
      assert.deepEqual(summary(preview), [
        { merchantId: b, lineCount: 1, residueFils: 1, outcome: "pending" },
        { merchantId: a, lineCount: 2, residueFils: 12, outcome: "pending" },
      ]);
      const legCount = async () => Number((await db.query(`SELECT count(*) FROM ledger_entries`)).rows[0].count);
      assert.equal(await legCount(), 0, "a preview posts nothing");

      const applied = await runMarchSweep(db, true);
      assert.deepEqual(applied.blocked, []);
      assert.deepEqual(summary(applied).map((m) => m.outcome), ["applied", "applied"]);
      const legs = await db.query(
        `SELECT entry_group_id, merchant_id, account_id, direction, amount_fils::int
           FROM ledger_entries ORDER BY amount_fils, direction`,
      );
      assert.deepEqual(legs.rows, [
        { entry_group_id: marchSweepGroupId(b), merchant_id: b, account_id: "scheme_rounding_residue", direction: "credit", amount_fils: 1 },
        { entry_group_id: marchSweepGroupId(b), merchant_id: b, account_id: "merchant_payable", direction: "debit", amount_fils: 1 },
        { entry_group_id: marchSweepGroupId(a), merchant_id: a, account_id: "scheme_rounding_residue", direction: "credit", amount_fils: 12 },
        { entry_group_id: marchSweepGroupId(a), merchant_id: a, account_id: "merchant_payable", direction: "debit", amount_fils: 12 },
      ]);

      const again = await runMarchSweep(db, true);
      assert.deepEqual(again.blocked, []);
      assert.deepEqual(summary(again).map((m) => m.outcome), ["already_applied", "already_applied"]);
      assert.equal(await legCount(), 4, "a second --apply posts nothing more");

      // A March capture that changes after posting no longer matches the
      // posted fingerprint: the sweep blocks instead of posting again.
      await capture(a, 1_001, "2026-03-25T10:00:00Z");
      const changed = await runMarchSweep(db, true);
      assert.equal(changed.blocked.length, 1);
      assert.match(changed.blocked[0]!, new RegExp(marchSweepGroupId(a)));
      assert.equal(await legCount(), 4);
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }
});
