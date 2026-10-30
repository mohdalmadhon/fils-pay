import { Query, type Pool } from "pg";
import { formatBhd, toFils } from "@filspay/money";
import type { TransactionRow } from "./serialize.js";

export interface TransactionsExportFilters {
  merchantId: string;
  from?: Date;
  to?: Date;
  status?: string[];
}

/**
 * One CSV cell. The reference is caller-supplied (often end-customer order
 * text), so a value starting with = + - @, tab or CR would be run as a
 * formula when the merchant opens the export in Excel or Sheets (CSV
 * injection: =HYPERLINK(...) to exfiltrate, =cmd|... on old Excel). Such
 * values get a leading ' so they open as text, per OWASP's guidance; then
 * the usual RFC 4180 quoting, now also on CR.
 */
export function csvEscape(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function toCsvRow(row: TransactionRow): string {
  return [
    row.id,
    row.status,
    formatBhd(toFils(Number(row.amount_fils))),
    formatBhd(toFils(Number(row.captured_fils))),
    csvEscape(row.reference ?? ""),
    row.occurred_at.toISOString(),
  ].join(",");
}

/** Builds the CSV body for `GET /v1/transactions/export`. */
export async function buildTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
): Promise<string> {
  const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
  const sql = `SELECT * FROM transactions
      WHERE merchant_id = $1
        AND ($2::timestamptz IS NULL OR occurred_at >= $2)
        AND ($3::timestamptz IS NULL OR occurred_at <  $3)
        AND ($4::text[] IS NULL OR status = ANY($4))
      ORDER BY occurred_at ASC`;

  const header = "id,status,amount_bhd,captured_bhd,reference,occurred_at";
  const lines = [header];
  const client = await pool.connect();
  let queryError: Error | undefined;
  let formattingFailed = false;
  let formattingError: unknown;
  try {
    // The SQL and row order stay unchanged, including timestamp ties.
    // A row listener prevents pg from also accumulating all decoded rows.
    // HTTP remains one buffered CSV response; this is not a paged export.
    await new Promise<void>((resolve, reject) => {
      const query = new Query(sql, [filters.merchantId, filters.from ?? null, filters.to ?? null, statusArray]);
      query.on("row", (row: TransactionRow) => {
        if (formattingFailed) return;
        try { lines.push(toCsvRow(row)); }
        catch (error) { formattingFailed = true; formattingError = error; }
      });
      query.once("error", reject);
      query.once("end", resolve);
      client.query(query);
    });
  } catch (error) {
    queryError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    // Consume the full query before releasing, even after formatting fails.
    client.release(queryError);
  }
  if (formattingFailed) throw formattingError;
  return lines.join("\n");
}


/** Cursor-paginated export for large date ranges. */
export async function streamTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
  write: (chunk: string) => void,
): Promise<void> {
  write("id,status,amount_bhd,captured_bhd,reference,occurred_at\n");

  let cursor: Date | null = null;
  const PAGE_SIZE = 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
    const result: { rows: TransactionRow[] } = await pool.query<TransactionRow>(
      `SELECT * FROM transactions
        WHERE merchant_id = $1
          AND ($2::timestamptz IS NULL OR occurred_at >= $2)
          AND ($3::timestamptz IS NULL OR occurred_at <  $3)
          AND ($4::text[] IS NULL OR status = ANY($4))
          AND ($5::timestamptz IS NULL OR occurred_at > $5)
        ORDER BY occurred_at ASC
        LIMIT $6`,
      [filters.merchantId, filters.from ?? null, filters.to ?? null, statusArray, cursor, PAGE_SIZE],
    );

    for (const row of result.rows) {
      write(toCsvRow(row) + "\n");
    }

    if (result.rows.length < PAGE_SIZE) break;
    cursor = result.rows[result.rows.length - 1]!.occurred_at;
  }
}
