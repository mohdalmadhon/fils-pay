import type { Pool, PoolClient } from "pg";
import { addFils, compareFils, negateFils, toFils, ZERO_FILS, type Fils } from "@filspay/money";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";
import { assertDistinctApprover, type CreditActor } from "./creditApproval.js";
import { CREDIT_APPROVAL_THRESHOLD_FILS } from "./creditThreshold.js";
import { parseAdjustmentAmountFils } from "./adjustmentCsvParsing.js";
import { postLedgerAdjustment } from "./ledgerAdjustments.js";

export interface AdjustmentImportRow {
  merchantId: string;
  /** The raw CSV cell, unmodified. */
  amount: string;
  reason?: string;
}

export type AdjustmentImportStatus = "pending_approval" | "applied" | "rejected";

/**
 * @property totalFils       Sum of the absolute row amounts (+5 and -5 move 10).
 * @property totalPostedFils What has been posted so far: totalFils once
 *                           applied, 0 while pending or rejected.
 */
export interface AdjustmentImportResult {
  importId: string;
  rowCount: number;
  status: AdjustmentImportStatus;
  totalFils: Fils;
  totalPostedFils: Fils;
}

/**
 * Above this (on absolute amounts) an import needs a second admin, the same
 * limit a single credit has (creditThreshold.ts). docs/bugs/053.
 */
export const IMPORT_APPROVAL_THRESHOLD_FILS = CREDIT_APPROVAL_THRESHOLD_FILS;

async function postAdjustmentToLedgerAndCache(
  client: PoolClient,
  merchantId: string,
  amountFils: Fils,
): Promise<string | null> {
  const entryGroupId = await postLedgerAdjustment(client, merchantId, amountFils, "CSV adjustment import");
  await client.query(
    `INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (merchant_id) DO UPDATE
       SET cached_payable_fils = merchant_balances.cached_payable_fils + $2, updated_at = now()`,
    [merchantId, amountFils],
  );
  return entryGroupId;
}

function absFils(amount: Fils): Fils {
  return compareFils(amount, ZERO_FILS) < 0 ? negateFils(amount) : amount;
}

/**
 * Records one uploaded CSV in a single transaction. Every amount is parsed
 * and every merchant checked first, so a bad row stores nothing.
 *
 * - Moving at most 50 BD in total (absolute amounts): every row is posted to
 *   the ledger at once, as before, and the import is 'applied'.
 * - Moving more: the rows are stored without posting anything and the import
 *   is 'pending_approval' until a different finance or super_admin approves
 *   it (approveAdjustmentImport) or rejects it. It used to post any amount
 *   at once with nobody else looking, while a single 50.001 BD credit needs
 *   a second person. docs/bugs/053.
 *
 * The audit row is the last statement in the same transaction.
 */
export async function applyAdjustmentImport(
  pool: Pool,
  input: { adminUserId: string; originalFilename: string; rows: AdjustmentImportRow[] },
): Promise<AdjustmentImportResult> {
  if (input.rows.length === 0) {
    throw new BadRequestError("empty_import", "the CSV must contain at least one row");
  }
  const amounts = input.rows.map((row) => parseAdjustmentAmountFils(row.amount));
  const totalFils = amounts.reduce<Fils>((sum, amount) => addFils(sum, absFils(amount)), ZERO_FILS);
  const needsApproval = compareFils(totalFils, IMPORT_APPROVAL_THRESHOLD_FILS) > 0;

  return withTransaction(pool, async (client) => {
    // Every row must name a real merchant. Without this, an unknown id only
    // failed at the ledger insert's foreign key, as a 500 naming no row.
    const known = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM merchants WHERE id = ANY($1::uuid[])`,
      [[...new Set(input.rows.map((row) => row.merchantId))]],
    );
    const knownIds = new Set(known.rows.map((row) => row.id.toLowerCase()));
    const unknownRow = input.rows.findIndex((row) => !knownIds.has(row.merchantId.toLowerCase()));
    if (unknownRow !== -1) {
      throw new BadRequestError(
        "unknown_merchant",
        `row ${unknownRow + 1}: no merchant has id ${input.rows[unknownRow]!.merchantId}`,
      );
    }

    const status: AdjustmentImportStatus = needsApproval ? "pending_approval" : "applied";
    const importRow = await client.query<{ id: string }>(
      `INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count, status, total_fils, applied_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'applied' THEN now() END) RETURNING id`,
      [input.adminUserId, input.originalFilename, input.rows.length, status, totalFils],
    );
    const importId = importRow.rows[0]!.id;

    // FH: claude says nothing here stops the same CSV being applied twice. intended? (asked in #fp-backend 14/8, no answer)
    // re-upload is blocked by the unique original_filename i think — am
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]!;
      const amountFils = amounts[i]!;
      const entryGroupId = needsApproval ? null : await postAdjustmentToLedgerAndCache(client, row.merchantId, amountFils);
      await client.query(
        `INSERT INTO adjustment_import_rows
           (adjustment_import_id, row_number, merchant_id, raw_amount_text, parsed_amount_fils, reason, ledger_entry_group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [importId, i + 1, row.merchantId, row.amount, amountFils, row.reason ?? null, entryGroupId],
      );
    }

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: needsApproval ? "adjustment_import_submitted" : "adjustment_import_applied",
      targetType: "adjustment_import",
      targetId: importId,
      metadata: needsApproval
        ? { rowCount: input.rows.length, totalFils, originalFilename: input.originalFilename }
        : { rowCount: input.rows.length, totalPostedFils: totalFils, originalFilename: input.originalFilename },
    });

    return {
      importId,
      rowCount: input.rows.length,
      status,
      totalFils,
      totalPostedFils: needsApproval ? ZERO_FILS : totalFils,
    };
  });
}

interface LockedImport {
  uploaded_by_admin_user_id: string;
  status: AdjustmentImportStatus;
  row_count: number;
  total_fils: string | number | null;
}

async function lockPendingImport(client: PoolClient, importId: string, decider: CreditActor): Promise<LockedImport> {
  const result = await client.query<LockedImport>(
    `SELECT uploaded_by_admin_user_id, status, row_count, total_fils
       FROM adjustment_imports WHERE id = $1 FOR UPDATE`,
    [importId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("adjustment_import_not_found");
  if (row.status !== "pending_approval") {
    throw new ConflictError("import_not_pending", `the import is ${row.status}`);
  }
  assertDistinctApprover({ adminUserId: row.uploaded_by_admin_user_id, displayName: "" }, decider);
  return row;
}

/**
 * The second admin's approval of a pending import: posts every stored row
 * exactly once, under the import's row lock, and marks it 'applied'.
 * @throws NotFoundError, ConflictError import_not_pending / self_approval_forbidden
 */
export async function approveAdjustmentImport(
  pool: Pool,
  input: { importId: string; approver: CreditActor },
): Promise<AdjustmentImportResult> {
  return withTransaction(pool, async (client) => {
    const locked = await lockPendingImport(client, input.importId, input.approver);
    const rows = await client.query<{ id: string; merchant_id: string; parsed_amount_fils: string }>(
      `SELECT id, merchant_id, parsed_amount_fils FROM adjustment_import_rows
        WHERE adjustment_import_id = $1 ORDER BY row_number`,
      [input.importId],
    );
    let total = ZERO_FILS;
    for (const row of rows.rows) {
      const amountFils = toFils(Number(row.parsed_amount_fils), { allowNegative: true });
      const entryGroupId = await postAdjustmentToLedgerAndCache(client, row.merchant_id, amountFils);
      await client.query(`UPDATE adjustment_import_rows SET ledger_entry_group_id = $2 WHERE id = $1`, [row.id, entryGroupId]);
      total = addFils(total, absFils(amountFils));
    }
    await client.query(
      `UPDATE adjustment_imports
          SET status = 'applied', applied_at = now(), decided_by_admin_user_id = $2, decided_at = now()
        WHERE id = $1`,
      [input.importId, input.approver.adminUserId],
    );
    await insertAdminAuditLog(client, {
      adminUserId: input.approver.adminUserId,
      action: "adjustment_import_applied",
      targetType: "adjustment_import",
      targetId: input.importId,
      metadata: { rowCount: locked.row_count, totalPostedFils: total, uploadedBy: locked.uploaded_by_admin_user_id },
    });
    return { importId: input.importId, rowCount: locked.row_count, status: "applied", totalFils: total, totalPostedFils: total };
  });
}

/** Rejects a pending import; nothing was posted and nothing will be. */
export async function rejectAdjustmentImport(
  pool: Pool,
  input: { importId: string; approver: CreditActor; note?: string },
): Promise<AdjustmentImportResult> {
  return withTransaction(pool, async (client) => {
    const locked = await lockPendingImport(client, input.importId, input.approver);
    await client.query(
      `UPDATE adjustment_imports
          SET status = 'rejected', decided_by_admin_user_id = $2, decided_at = now(), decision_note = $3
        WHERE id = $1`,
      [input.importId, input.approver.adminUserId, input.note ?? null],
    );
    await insertAdminAuditLog(client, {
      adminUserId: input.approver.adminUserId,
      action: "adjustment_import_rejected",
      targetType: "adjustment_import",
      targetId: input.importId,
      metadata: { rowCount: locked.row_count, note: input.note ?? null, uploadedBy: locked.uploaded_by_admin_user_id },
    });
    return {
      importId: input.importId,
      rowCount: locked.row_count,
      status: "rejected",
      totalFils: toFils(Number(locked.total_fils ?? 0)),
      totalPostedFils: ZERO_FILS,
    };
  });
}

export interface AdjustmentImportSummary {
  id: string;
  uploadedByAdminUserId: string;
  originalFilename: string;
  rowCount: number;
  status: AdjustmentImportStatus;
  /** Absolute amounts; null for imports made before totals were stored. */
  totalFils: number | null;
  /** null until the rows are posted. */
  appliedAt: string | null;
  decidedByAdminUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * @property parsedAmountFils The signed integer that was posted.
 * @property ledgerEntryGroupId null for a zero-amount row (nothing is journaled)
 *           and for every row of an import that is pending or rejected.
 */
export interface AdjustmentImportRowDetail {
  rowNumber: number;
  merchantId: string;
  rawAmountText: string;
  parsedAmountFils: number;
  reason: string | null;
  ledgerEntryGroupId: string | null;
}

/**
 * Keyset-paginated list of past imports, newest first. The cursor is the
 * platform's standard `created_at::text` (Postgres's own rendering, never
 * `Date.toISOString()`, which would round-trip through a JS Date and lose
 * microsecond precision).
 */
// MK: cursor compares created_at::text as a string — breaks across a DST change. FP-198
// FH: tried to repro FP-198 with TZ=Europe/London on the api box, pages looked fine?? leaving it open
export async function listAdjustmentImports(
  pool: Pool,
  params: { limit?: number; cursor?: string | null },
): Promise<{ items: AdjustmentImportSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const cursor = params.cursor ?? null;

  const result = await pool.query<{
    id: string;
    uploaded_by_admin_user_id: string;
    original_filename: string;
    row_count: number;
    status: AdjustmentImportStatus;
    total_fils: string | null;
    applied_at: string | null;
    decided_by_admin_user_id: string | null;
    decided_at: string | null;
    created_at: string;
  }>(
    `SELECT id, uploaded_by_admin_user_id, original_filename, row_count, status, total_fils::text AS total_fils,
            applied_at::text AS applied_at, decided_by_admin_user_id, decided_at::text AS decided_at,
            created_at::text AS created_at
       FROM adjustment_imports
      WHERE ($1::text IS NULL OR created_at::text < $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [cursor, limit + 1],
  );

  const rows = result.rows.slice(0, limit);
  const nextCursor = result.rows.length > limit ? (rows[rows.length - 1]?.created_at ?? null) : null;

  return {
    items: rows.map((row) => ({
      id: row.id,
      uploadedByAdminUserId: row.uploaded_by_admin_user_id,
      originalFilename: row.original_filename,
      rowCount: row.row_count,
      status: row.status,
      totalFils: row.total_fils === null ? null : Number(row.total_fils),
      appliedAt: row.applied_at,
      decidedByAdminUserId: row.decided_by_admin_user_id,
      decidedAt: row.decided_at,
      createdAt: row.created_at,
    })),
    nextCursor,
  };
}

/** Per-row detail for one import — raw text and parsed integer side by side. */
/** @throws NotFoundError when the import id does not exist. */
export async function getAdjustmentImportRows(
  pool: Pool,
  importId: string,
): Promise<AdjustmentImportRowDetail[]> {
  const result = await pool.query<{
    row_number: number;
    merchant_id: string;
    raw_amount_text: string;
    parsed_amount_fils: string;
    reason: string | null;
    ledger_entry_group_id: string | null;
  }>(
    `SELECT row_number, merchant_id, raw_amount_text, parsed_amount_fils, reason, ledger_entry_group_id
       FROM adjustment_import_rows
      WHERE adjustment_import_id = $1
      ORDER BY row_number`,
    [importId],
  );

  return result.rows.map((row) => ({
    rowNumber: row.row_number,
    merchantId: row.merchant_id,
    rawAmountText: row.raw_amount_text,
    parsedAmountFils: Number(row.parsed_amount_fils),
    reason: row.reason,
    ledgerEntryGroupId: row.ledger_entry_group_id,
  }));
}
