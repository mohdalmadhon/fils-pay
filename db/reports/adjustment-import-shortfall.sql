-- Read-only report: adjustment-import rows posted with the wrong amount.
--
-- Until the fix in apps/api/src/admin/adjustmentCsvParsing.ts, the CSV
-- importer read BD amounts as if they had 2 decimal places (cents), so
-- "4.75" BD was posted as 475 fils instead of 4750, and a third decimal was
-- dropped ("4.755" -> 475). The original text of every row is kept in
-- adjustment_import_rows.raw_amount_text, so the intended amount can be
-- recomputed exactly.
--
-- This changes nothing. Finance decides how each shortfall is corrected
-- (a follow-up import of the differences, or a manual credit). Run with:
--   psql "$DATABASE_URL" -f db/reports/adjustment-import-shortfall.sql

WITH rows AS (
  SELECT r.adjustment_import_id,
         i.original_filename,
         i.created_at AS imported_at,
         r.row_number,
         r.merchant_id,
         r.raw_amount_text,
         r.parsed_amount_fils AS posted_fils,
         -- numeric is exact; 1 BD = 1000 fils.
         (trim(r.raw_amount_text)::numeric * 1000) AS intended_fils_exact
    FROM adjustment_import_rows r
    JOIN adjustment_imports i ON i.id = r.adjustment_import_id
   WHERE trim(r.raw_amount_text) ~ '^-?\d+(\.\d+)?$'
)
SELECT adjustment_import_id,
       original_filename,
       imported_at,
       row_number,
       merchant_id,
       raw_amount_text,
       posted_fils,
       intended_fils_exact::bigint            AS intended_fils,
       intended_fils_exact::bigint - posted_fils AS shortfall_fils,
       intended_fils_exact <> trunc(intended_fils_exact) AS had_more_than_3_decimals
  FROM rows
 WHERE intended_fils_exact <> posted_fils
 ORDER BY imported_at, adjustment_import_id, row_number;

-- Per-merchant total still owed (positive) or over-credited (negative):
--
-- SELECT merchant_id, sum(intended_fils - posted_fils) AS shortfall_fils
--   FROM (<the query above>) q GROUP BY merchant_id ORDER BY 2 DESC;
