#!/usr/bin/env -S npx tsx
/**
 * March 2026 residue sweep. Default is a read-only preview; --apply is
 * required to post. Legacy/ambiguous postings block the whole sweep.
 * See docs/solved-problems/012-march-sweep-repeat-postings.md before use.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { formatBhd, toFils } from "@filspay/money";

const DESCRIPTION = "March 2026 scheme rounding residue sweep — manual recon per finance";
const DESCRIPTION_PREFIX = `${DESCRIPTION}; source_sha256=`;

/** Asia/Bahrain is UTC+3 all year (no daylight saving since 1972). */
const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * The Bahrain calendar month: [1st 00:00 +03:00, next 1st 00:00 +03:00).
 * It used to be the UTC month, which moved the first three Bahrain hours of
 * the month into the month before and took the next month's first three in.
 * Batches use the Bahrain business day, so the sweep must too, or it can't
 * be checked against them (ADR 0009, docs/bugs/017).
 */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - BAHRAIN_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - BAHRAIN_OFFSET_MS),
  };
}

export interface ResidueRow {
  merchantId: string;
  transactionId: string;
  capturedFils: string;
  occurredAtEpoch: string;
}

/** The fils truncated away at the scheme's two-decimal boundary. */
export function computeResidueFils(capturedFils: number): number {
  return capturedFils % 10;
}

interface MerchantResidue {
  merchantId: string;
  lineCount: number;
  residueFils: number;
  sourceFingerprint: string;
}

/** Stable UUID-shaped operation key: same March correction and merchant. */
export function marchSweepGroupId(merchantId: string): string {
  const bytes = createHash("sha256").update(`filspay:march-2026-residue:v1:${merchantId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // UUID version 8, application-defined
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function fetchResidueRows(client: Client): Promise<ResidueRow[]> {
  const { start, end } = monthBounds(2026, 3);
  const result = await client.query<{
    merchant_id: string; id: string; captured_fils: string; occurred_at_epoch: string;
  }>(
    `SELECT merchant_id, id, captured_fils, EXTRACT(EPOCH FROM occurred_at)::text AS occurred_at_epoch
       FROM transactions
      WHERE captured_fils > 0 AND captured_fils % 10 <> 0
        AND occurred_at >= $1 AND occurred_at < $2
      ORDER BY merchant_id, id`,
    [start.toISOString(), end.toISOString()],
  );
  return result.rows.map((r) => ({
    merchantId: r.merchant_id, transactionId: r.id,
    capturedFils: r.captured_fils, occurredAtEpoch: r.occurred_at_epoch,
  }));
}

function groupByMerchant(rows: ResidueRow[]): MerchantResidue[] {
  const byMerchant = new Map<string, MerchantResidue & { hash: ReturnType<typeof createHash> }>();
  for (const row of rows) {
    let merchant = byMerchant.get(row.merchantId);
    if (!merchant) {
      merchant = { merchantId: row.merchantId, lineCount: 0, residueFils: 0,
        sourceFingerprint: "", hash: createHash("sha256") };
      byMerchant.set(row.merchantId, merchant);
    }
    // BIGINT database amounts stay exact, including above Number.MAX_SAFE_INTEGER.
    const residue = Number(BigInt(row.capturedFils) % 10n);
    merchant.lineCount += 1;
    merchant.residueFils = toFils(merchant.residueFils + residue);
    merchant.hash.update(JSON.stringify([row.transactionId, row.capturedFils, row.occurredAtEpoch]) + "\n");
  }
  return [...byMerchant.values()].map(({ hash, ...merchant }) => ({
    ...merchant, sourceFingerprint: hash.digest("hex"),
  }));
}

interface LedgerLeg {
  entry_group_id: string;
  merchant_id: string;
  account_id: string;
  direction: string;
  amount_fils: string;
  description: string | null;
  transaction_id: string | null;
  settlement_batch_id: string | null;
}

export interface MarchSweepReport {
  mode: "dry-run" | "apply";
  blocked: string[];
  merchants: Array<MerchantResidue & { entryGroupId: string; outcome: "pending" | "already_applied" | "applied" }>;
}

/** Owns a transaction on an otherwise idle client. Never repairs historical duplicates. */
export async function runMarchSweep(client: Client, apply = false): Promise<MarchSweepReport> {
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    if (apply) {
      // Serialize check-and-post, also blocking non-cooperating ledger writers
      // during this transaction. Run in maintenance, with old script copies retired.
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("LOCK TABLE transactions IN SHARE MODE");
      await client.query("LOCK TABLE ledger_entries IN SHARE ROW EXCLUSIVE MODE");
    }
    const merchants: MarchSweepReport["merchants"] = groupByMerchant(await fetchResidueRows(client))
      .map((m) => ({ ...m, entryGroupId: marchSweepGroupId(m.merchantId), outcome: "pending" }));
    // Read entire groups, not just matching descriptions: extra or altered legs
    // must not be mistaken for a clean prior application.
    const history = await client.query<LedgerLeg>(
      `SELECT entry_group_id, merchant_id, account_id, direction, amount_fils, description,
              transaction_id, settlement_batch_id
         FROM ledger_entries
        WHERE entry_group_id IN (
          SELECT entry_group_id FROM ledger_entries
           WHERE description = $1 OR starts_with(description, $2)
        ) OR entry_group_id = ANY($3::uuid[])
        ORDER BY entry_group_id, id`,
      [DESCRIPTION, DESCRIPTION_PREFIX, merchants.map((m) => m.entryGroupId)],
    );
    const groups = new Map<string, LedgerLeg[]>();
    for (const leg of history.rows) {
      const legs = groups.get(leg.entry_group_id) ?? [];
      legs.push(leg);
      groups.set(leg.entry_group_id, legs);
    }
    const expected = new Map(merchants.map((m) => [m.entryGroupId, m]));
    const blocked: string[] = [];
    for (const [groupId, legs] of groups) {
      const merchant = expected.get(groupId);
      if (!merchant) {
        blocked.push(`group ${groupId}: legacy/unknown posting or source no longer matches; review ledger history`);
        continue;
      }
      const description = DESCRIPTION_PREFIX + merchant.sourceFingerprint;
      const valid = legs.length === 2 && legs.every((leg) =>
        leg.merchant_id === merchant.merchantId && leg.amount_fils === String(merchant.residueFils)
        && leg.description === description && leg.transaction_id === null && leg.settlement_batch_id === null)
        && legs.filter((leg) => leg.account_id === "merchant_payable" && leg.direction === "debit").length === 1
        && legs.filter((leg) => leg.account_id === "scheme_rounding_residue" && leg.direction === "credit").length === 1;
      if (!valid) {
        blocked.push(`group ${groupId}: amounts, source fingerprint or ledger legs differ; review required`);
      } else {
        merchant.outcome = "already_applied";
      }
    }
    const report: MarchSweepReport = { mode: apply ? "apply" : "dry-run", blocked, merchants };
    if (apply && blocked.length === 0) {
      const now = new Date();
      for (const merchant of merchants) {
        if (merchant.outcome !== "pending") continue;
        await client.query(
          `INSERT INTO ledger_entries
             (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
           VALUES ($1, $2, 'merchant_payable', 'debit', $3, $4, $5),
                  ($1, $2, 'scheme_rounding_residue', 'credit', $3, $4, $5)`,
          [merchant.entryGroupId, merchant.merchantId, merchant.residueFils, now.toISOString(),
            DESCRIPTION_PREFIX + merchant.sourceFingerprint],
        );
        merchant.outcome = "applied";
      }
    }
    // Report only after commit; even deferred ledger-trigger failures propagate.
    await client.query("COMMIT");
    return report;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--apply")
      || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Usage: reconcile_march.ts [--dry-run | --apply]; default: --dry-run");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("reconcile_march: DATABASE_URL environment variable is not set");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const report = await runMarchSweep(client, args.includes("--apply"));
    console.log(`March 2026 sweep ${report.mode}; inspected at ${new Date().toISOString()}`);
    console.log("window: 2026-03-01T00:00:00+03:00 .. 2026-04-01T00:00:00+03:00 (the Bahrain month of March only, not all Q1)");
    for (const merchant of report.merchants) {
      console.log(`merchant ${merchant.merchantId}: ${merchant.lineCount} transaction(s), `
        + `${formatBhd(toFils(merchant.residueFils))} BD (${merchant.residueFils} fils), `
        + `group ${merchant.entryGroupId}, ${merchant.outcome}`);
    }
    for (const reason of report.blocked) console.error(`BLOCKED: ${reason}`);
    if (report.blocked.length > 0) process.exitCode = 1;
    console.log(report.blocked.length > 0 ? "No corrections posted; historical review required."
      : report.mode === "dry-run" ? "Read-only preview; no corrections posted."
      : "Committed; applied groups posted once, already_applied groups unchanged.");
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
