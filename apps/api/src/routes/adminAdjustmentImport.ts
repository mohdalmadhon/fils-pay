import type { FastifyInstance } from "fastify";
import { requireAdminRole, requireAdminSession } from "../adminAuth/middleware.js";
import {
  applyAdjustmentImport,
  approveAdjustmentImport,
  getAdjustmentImportRows,
  listAdjustmentImports,
  rejectAdjustmentImport,
} from "../admin/adjustmentImport.js";
import { parseAdjustmentCsv } from "../admin/adjustmentCsvParsing.js";
import { UUID_RE } from "../admin/merchants.js";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { parseLimitParam } from "../lib/queryParams.js";

interface ImportIdParams {
  id: string;
}

/**
 * csvContent: "merchantId,amount,reason" rows, amount in BD with up to 3
 * decimals (e.g. 4.750). originalFilename is informational only.
 */
interface CreateImportBody {
  csvContent?: unknown;
  originalFilename?: unknown;
}

interface ListQuery {
  limit?: string;
  cursor?: string;
}

/** Registered with prefix '/v1/admin/adjustment-imports'. */
export async function adminAdjustmentImportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Upload a CSV of manual balance adjustments. One that moves at most 50 BD
   * in total (absolute amounts) is applied at once: 201, status 'applied'.
   * One that moves more is stored but posts nothing until a second finance
   * or super_admin approves it (POST /:id/approve): 202, status
   * 'pending_approval'. The same two-person rule as a single credit; it used
   * to post any amount at once (docs/bugs/053).
   *
   * finance/super_admin only — every row posts real money.
   *
   * Size: Fastify's default 1 MB body limit used to apply here, so an
   * export of more than roughly 15 000 rows was refused with a bare 413
   * before any of this ran. The limit is now ADJUSTMENT_IMPORT_MAX_BYTES
   * (10 MB by default), and a file over ADJUSTMENT_IMPORT_MAX_ROWS rows
   * (20 000) is refused with a clear message before anything is posted, so
   * one upload can't hold a transaction open over an unbounded number of
   * ledger postings.
   */
  app.post<{ Body: CreateImportBody }>(
    "/",
    {
      preHandler: [requireAdminSession, requireAdminRole("finance", "super_admin")],
      bodyLimit: app.config.adjustmentImportMaxBytes,
    },
    async (request, reply) => {
      const adminAuth = request.adminAuth;
      if (!adminAuth) throw new UnauthorizedError("unauthenticated");

      const { csvContent, originalFilename } = request.body ?? {};
      if (typeof csvContent !== "string" || csvContent.trim() === "") {
        throw new BadRequestError("invalid_request", "csvContent is required and must be a non-empty string");
      }
      if (originalFilename !== undefined && typeof originalFilename !== "string") {
        throw new BadRequestError("invalid_request", "originalFilename, if given, must be a string");
      }

      // am: no dry run and no idempotency key — uploading the same csv twice posts it twice
      // MK: finance checks the spreadsheet before uploading. fine for now
      // Keep amount cells as text; applyAdjustmentImport parses BD to exact fils.
      const rows = parseAdjustmentCsv(csvContent);
      if (rows.length > app.config.adjustmentImportMaxRows) {
        throw new BadRequestError(
          "import_too_large",
          `the CSV has ${rows.length} rows; split it into files of at most ${app.config.adjustmentImportMaxRows} rows`,
        );
      }
      for (const row of rows) {
        if (!UUID_RE.test(row.merchantId)) {
          throw new BadRequestError("invalid_csv_row", `"${row.merchantId}" is not a merchant id`);
        }
      }

      const result = await applyAdjustmentImport(app.db, {
        adminUserId: adminAuth.adminUserId,
        originalFilename: originalFilename ?? "pasted.csv",
        rows,
      });

      reply.code(result.status === "pending_approval" ? 202 : 201).send(result);
    },
  );

  /** The second admin's decision on a pending import. finance/super_admin,
   *  and never the admin who uploaded it (409 self_approval_forbidden). */
  for (const decision of ["approve", "reject"] as const) {
    app.post<{ Params: ImportIdParams; Body: { note?: unknown } }>(
      `/:id/${decision}`,
      { preHandler: [requireAdminSession, requireAdminRole("finance", "super_admin")] },
      async (request) => {
        const adminAuth = request.adminAuth;
        if (!adminAuth) throw new UnauthorizedError("unauthenticated");
        if (!UUID_RE.test(request.params.id)) {
          throw new NotFoundError("adjustment_import_not_found");
        }
        const note = request.body?.note;
        if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
          throw new BadRequestError("invalid_request", "note, if given, must be a string of at most 500 characters");
        }
        const approver = { adminUserId: adminAuth.adminUserId, displayName: "" };
        return decision === "approve"
          ? approveAdjustmentImport(app.db, { importId: request.params.id, approver })
          : rejectAdjustmentImport(app.db, { importId: request.params.id, approver, note });
      },
    );
  }

  /** History of past imports. Any admin role — a read. */
  app.get<{ Querystring: ListQuery }>(
    "/",
    { preHandler: [requireAdminSession] },
    async (request) => {
      const limit = parseLimitParam(request.query.limit);
      return listAdjustmentImports(app.db, {
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor: request.query.cursor ?? null,
      });
    },
  );

  /** Per-row detail — the raw CSV text next to the integer that was posted. */
  app.get<{ Params: ImportIdParams }>(
    "/:id/rows",
    { preHandler: [requireAdminSession] },
    async (request) => {
      if (!UUID_RE.test(request.params.id)) {
        throw new NotFoundError("adjustment_import_not_found");
      }
      const rows = await getAdjustmentImportRows(app.db, request.params.id);
      if (rows.length === 0) {
        throw new NotFoundError("adjustment_import_not_found");
      }
      return { rows };
    },
  );
}
