import type { FastifyInstance } from "fastify";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { runTransactionsReport, type TransactionReportFilter } from "../reporting/transactionsReportQuery.js";
import { resolveReportMerchantId } from "../reporting/scope.js";
import { createSavedFilter, listSavedFilters } from "../reporting/savedFilters.js";
import { BadRequestError } from "../lib/errors.js";

interface ReportQuery {
  filter?: string;
}

const TRANSACTION_STATUSES = new Set([
  "authorized",
  "captured",
  "partially_captured",
  "voided",
  "partially_refunded",
  "refunded",
  "chargeback",
]);

/** YYYY-MM-DD, optionally followed by a time and a zone (ISO 8601). */
const ISO_DATE_OR_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isIsoDateOrDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_OR_DATETIME_RE.exec(value);
  if (!match) return false;
  // The date part must be a real day (no 2026-02-30), and the whole value
  // must parse (no 25:00).
  const day = match[1]!;
  const asUtc = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== day) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * The `?filter=` query value: a JSON object with optional `merchantId`,
 * `status` (a transaction status), `from` and `to` (ISO dates or date-times).
 * Anything else is a 400, before it can reach SQL.
 */
function parseReportFilter(raw: unknown): Partial<TransactionReportFilter> {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string") {
    throw new BadRequestError("invalid_filter", "filter must be given once, as a JSON object");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BadRequestError("invalid_filter", "filter must be valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError("invalid_filter", "filter must be a JSON object");
  }
  const filter = value as Record<string, unknown>;
  // null or "" means "not set", as it always has (the query skips falsy values).
  if (filter.status != null && filter.status !== "" && (typeof filter.status !== "string" || !TRANSACTION_STATUSES.has(filter.status))) {
    throw new BadRequestError("invalid_filter", `status must be one of ${[...TRANSACTION_STATUSES].join(", ")}`);
  }
  for (const key of ["from", "to"] as const) {
    if (filter[key] != null && filter[key] !== "" && !isIsoDateOrDateTime(filter[key])) {
      throw new BadRequestError("invalid_filter", `${key} must be an ISO 8601 date or date-time`);
    }
  }
  return filter as Partial<TransactionReportFilter>;
}

interface SaveFilterBody {
  name?: string;
  filter?: Record<string, unknown>;
}

/**
 * Registered with prefix '/v1/reporting'. The reads need `requireMerchantAuth`
 * only, same authorization level as `/v1/analytics/*` — nothing here is more
 * sensitive than a merchant reading their own transaction list already is
 * (in the intended, single-merchant case). Saving a filter is a write and is
 * gated like one.
 */
export async function reportingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ReportQuery }>(
    "/transactions",
    { preHandler: requireMerchantAuth },
    async (request) => {
      const parsed = parseReportFilter(request.query.filter);

      const merchantId = await resolveReportMerchantId(
        app.db,
        request.merchantAuth!.merchantId,
        parsed.merchantId,
      );

      return runTransactionsReport(app.db, {
        merchantId,
        status: parsed.status,
        from: parsed.from,
        to: parsed.to,
      });
    },
  );

  /** A write: owner and finance only (like the other merchant write routes),
   *  and never from a view-only "view as merchant" session. */
  app.post<{ Body: SaveFilterBody }>(
    "/saved-filters",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      requireMerchantWriterActor(request.merchantAuth!);
      const { name, filter } = request.body ?? {};
      if (!name || typeof name !== "string") {
        throw new BadRequestError("invalid_request", "name is required");
      }
      if (!filter || typeof filter !== "object") {
        throw new BadRequestError("invalid_request", "filter is required");
      }

      const saved = await createSavedFilter(app.db, {
        merchantId: request.merchantAuth!.merchantId,
        name,
        filter,
      });
      reply.code(201).send(saved);
    },
  );

  app.get(
    "/saved-filters",
    { preHandler: requireMerchantAuth },
    async (request) => listSavedFilters(app.db, { merchantId: request.merchantAuth!.merchantId }),
  );

  app.get("/export-summary", { preHandler: requireMerchantAuth }, async (request) => {
    const result = await app.db.query(
      `SELECT COUNT(*) AS total, SUM(captured_gross_fils) AS gross
         FROM merchant_daily_volume WHERE merchant_id = $1`,
      [request.merchantAuth!.merchantId],
    );
    return { totalDays: Number(result.rows[0]?.total ?? 0), grossFils: Number(result.rows[0]?.gross ?? 0) };
  });
}
