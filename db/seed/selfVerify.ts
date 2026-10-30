import { allocateRemainder, applyRateFils, toFils } from "@filspay/money";
import type { Pool } from "pg";
import { computeLedgerChecksum, generate, type SeedSummary } from "./generate.js";

export interface Assertion {
  id: string;
  description: string;
  status: "real" | "deferred";
  /** Required when status === 'deferred': says what the assertion is
   *  waiting on. */
  deferredUntilPhase?: string;
  run: () => Promise<{ pass: boolean; detail?: string }>;
}

/**
 * Builds the ordered assertion list. `initialLedgerChecksum` is the
 * checksum captured immediately after the seed run that already populated
 * the database (see index.ts) — the `seed-deterministic` assertion
 * re-generates from scratch and compares against it. That re-run truncates
 * api_keys and issues new keys, so it hands its summary to `onRegenerated`:
 * the caller must print the keys from the latest run, not the first.
 */
export function buildAssertions(
  pool: Pool,
  ctx: { initialLedgerChecksum: string; onRegenerated?: (summary: SeedSummary) => void },
): Assertion[] {
  return [
    {
      id: "ledger-balances",
      description: "Every entry_group_id in ledger_entries sums debits = credits",
      status: "real",
      run: async () => {
        const result = await pool.query<{ entry_group_id: string; net: string }>(`
          SELECT entry_group_id,
                 SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) AS net
            FROM ledger_entries
        GROUP BY entry_group_id
          HAVING SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) <> 0
        `);
        const pass = result.rows.length === 0;
        return {
          pass,
          detail: pass
            ? undefined
            : `${result.rows.length} unbalanced group(s), e.g. ${result.rows[0]?.entry_group_id} net ${result.rows[0]?.net} fils`,
        };
      },
    },
    {
      id: "captured-le-authorized",
      description: "Every transaction has captured_fils <= amount_fils",
      status: "real",
      run: async () => {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM transactions WHERE captured_fils > amount_fils`,
        );
        const count = Number(result.rows[0]?.count ?? "0");
        return { pass: count === 0, detail: count === 0 ? undefined : `${count} violating row(s)` };
      },
    },
    {
      id: "allocate-remainder-self-test",
      description:
        "allocateRemainder sums back to the exact total across several adversarial weight sets",
      status: "real",
      run: async () => {
        const cases: Array<{ total: number; weights: number[] }> = [
          { total: 100, weights: [1, 1, 1] },
          { total: 9_973, weights: [17, 19, 23] },
          { total: 1, weights: [1, 1, 1, 1, 1] },
          { total: 4_750, weights: [0.3333, 0.3333, 0.3334] },
          { total: 1_234_567, weights: [3, 1, 4, 1, 5, 9, 2, 6] },
        ];
        for (const { total, weights } of cases) {
          const shares = allocateRemainder(toFils(total), weights);
          const sum = shares.reduce((acc, s) => acc + s, 0);
          if (sum !== total) {
            return {
              pass: false,
              detail: `weights=${JSON.stringify(weights)} total=${total} summed to ${sum}`,
            };
          }
        }
        return { pass: true };
      },
    },
    {
      id: "scheme-lines-quantized",
      description: "Every scheme_export_lines.amount_fils is a multiple of 10",
      status: "real",
      run: async () => {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM scheme_export_lines WHERE amount_fils % 10 <> 0`,
        );
        const count = Number(result.rows[0]?.count ?? "0");
        return { pass: count === 0, detail: count === 0 ? undefined : `${count} non-quantized row(s)` };
      },
    },
    {
      id: "capture-fees-follow-fee-schedules",
      description:
        "Every seeded capture's fee leg is its amount at the rate in effect when it happened (fee_schedules, else mdr_bps), for merchants without a negotiated discount",
      status: "real",
      run: async () => {
        // The same rate rule as apps/api/src/fees/feeSchedule.ts.
        const result = await pool.query<{ entry_group_id: string; gross: string; fee: string; bps: number }>(`
          WITH g AS (
            SELECT le.entry_group_id, le.merchant_id, max(le.occurred_at) AS at,
                   SUM(le.amount_fils) FILTER (WHERE le.account_id = 'card_scheme_clearing' AND le.direction = 'debit') AS gross,
                   COALESCE(SUM(le.amount_fils) FILTER (WHERE le.account_id = 'platform_fee_revenue' AND le.direction = 'credit'), 0) AS fee
              FROM ledger_entries le
             WHERE le.description LIKE 'capture %'
          GROUP BY le.entry_group_id, le.merchant_id
          )
          SELECT g.entry_group_id, g.gross::text AS gross, g.fee::text AS fee,
                 COALESCE((SELECT fs.mdr_bps FROM fee_schedules fs
                            WHERE fs.merchant_id = g.merchant_id AND fs.effective_from <= g.at
                         ORDER BY fs.effective_from DESC, fs.created_at DESC, fs.id DESC LIMIT 1), m.mdr_bps) AS bps
            FROM g JOIN merchants m ON m.id = g.merchant_id
           WHERE m.negotiated_discount_bps = 0 AND g.gross IS NOT NULL
        `);
        const wrong = result.rows.filter((r) => Number(applyRateFils(toFils(Number(r.gross)), r.bps)) !== Number(r.fee));
        return {
          pass: result.rows.length > 0 && wrong.length === 0,
          detail:
            result.rows.length === 0
              ? "no capture ledger groups found"
              : `${wrong.length} of ${result.rows.length} capture fee(s) differ, e.g. group ${wrong[0]?.entry_group_id}: ` +
                `${wrong[0]?.fee} fils on ${wrong[0]?.gross} at ${wrong[0]?.bps} bps`,
        };
      },
    },
    {
      id: "seed-deterministic",
      description:
        "Re-running generate() against a fresh DB with the same SEED yields identical row counts and an identical checksum of ledger_entries",
      status: "real",
      run: async () => {
        const rerun = await generate(pool);
        ctx.onRegenerated?.(rerun);
        const rerunChecksum = await computeLedgerChecksum(pool);
        if (rerunChecksum !== rerun.ledgerChecksum) {
          return { pass: false, detail: "generate()'s own returned checksum did not match a fresh re-query" };
        }
        if (rerunChecksum !== ctx.initialLedgerChecksum) {
          return {
            pass: false,
            detail: `checksum drifted across runs: ${ctx.initialLedgerChecksum} vs ${rerunChecksum}`,
          };
        }
        return { pass: true };
      },
    },
  ];
}

/**
 * Runs every assertion in order, printing one line per assertion. Deferred
 * assertions are never invoked — they are skipped outright with an
 * explicit SKIP marker, so a drifted or premature "green" self-verify can
 * never be mistaken for the real thing. Returns true iff every REAL
 * assertion passed.
 */
export async function runAssertions(assertions: Assertion[]): Promise<boolean> {
  let allRealPassed = true;

  for (const assertion of assertions) {
    if (assertion.status === "deferred") {
      console.log(`SKIP   (deferred to ${assertion.deferredUntilPhase})  ${assertion.id}  ${assertion.description}`);
      continue;
    }

    const { pass, detail } = await assertion.run();
    if (pass) {
      console.log(`REAL   PASS  ${assertion.id}  ${assertion.description}`);
    } else {
      allRealPassed = false;
      console.log(`REAL   FAIL  ${assertion.id}  ${assertion.description}  — ${detail ?? "no detail"}`);
    }
  }

  return allRealPassed;
}
