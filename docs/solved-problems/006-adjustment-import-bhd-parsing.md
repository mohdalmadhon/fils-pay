# 006 — CSV adjustment import misreads BD as two-decimal minor units

Recorded: 2026-10-29.

Status: implemented locally and verified through the real importer in a
disposable local PostgreSQL database. Historical imports and production
balances were not changed.

## Reported problem and confirmed behavior

The user reported `4.755 BD` appearing as `4.750 BD`, and `4.75 BD`
appearing as `0.475 BD` in the ledger.

The confirmed code defect explains the tenfold under-posting and loss of
third-decimal precision. However, the checked pre-fix code converts both
`4.755` and `4.75` to **475 fils**, which is **0.475 BD**. It does not
reproduce the first reported stored value of 4.750 BD on its own. That
specific observation still needs the original import detail and ledger
records; no second conversion path is assumed here.

## Root cause

`parseAdjustmentAmountFils` called the generic `parseDecimalMinor(raw)`
without a decimal-count argument. Its default is **two**, suitable for a
currency with 100 minor units per whole unit. It pads or truncates the
fraction to two digits and concatenates it with the whole part.

The importer then branded that integer as **fils**, although one BD is
**1,000 fils**. The brand validates an integer; it cannot infer that its
currency unit was wrong.

| CSV amount in BD | Old parsed integer, incorrectly treated as fils | Old value in BD | Correct fils |
|---|---:|---:|---:|
| `4.755` | 475 | 0.475 | 4,755 |
| `4.75` | 475 | 0.475 | 4,750 |
| `4.750` | 475 | 0.475 | 4,750 |
| `12` | 1,200 | 1.200 | 12,000 |

For three-decimal inputs, the generic parser first discarded the third
digit. Independently, its two-decimal scale was one tenth of the BD scale.
This was not a formatting-only difference: the parsed integer was posted
to the ledger and cache and saved in the import detail rows.

## Fix and affected lines

The importer now calls the existing finance-validated BHD parser directly:

```ts
return parseBhdToFils(raw);
```

That helper uses exact string and integer arithmetic, accepts zero through
three fractional digits, handles signed deltas, and rejects malformed,
over-precision, or unsafe-integer amounts. The existing `invalid_amount`
error mapping is retained. Failure remains inside the import transaction,
so one invalid row rolls back the whole upload.

| Location | Change or role |
|---|---|
| [adjustmentCsvParsing.ts:1](../../apps/api/src/admin/adjustmentCsvParsing.ts#L1), lines 1–10 | Replace the generic parser plus `toFils` with `parseBhdToFils`; retain the API error contract |
| [adminAdjustmentImport.ts](../../apps/api/src/routes/adminAdjustmentImport.ts), create-import route | Correct the misleading inline assertion that splitting CSV text itself performed BD conversion; parsing still occurs in the importer |
| [AdjustmentImportPage.tsx:102](../../apps/admin/src/pages/adjustments/AdjustmentImportPage.tsx#L102) | State the amount unit and show that `4.75` means `4.750 BD` |
| [Admin guide](../ADMIN.md#money) | Document exact BD/fils examples, signed amounts, strict precision, and the historic-data limitation |
| [adjustmentImport.ts:67](../../apps/api/src/admin/adjustmentImport.ts#L67), unchanged | Uses the corrected parsed value for ledger/cache posting and `parsed_amount_fils` while retaining the input amount text |

Neither frozen money package was modified. The generic decimal utility
was left unchanged; it is no longer used by this import path. CSV splitting,
role checks, posting directions, audit handling, and duplicate-upload
behavior are unchanged.

## Reference trail

The original code and replaced route comment are available with
`git show ae8bfc1:<path>` for the paths below.

| Reference | Evidence and limits |
|---|---|
| [Generic decimal utility](../../apps/api/src/lib/decimal.ts#L4), `parseDecimalMinor` | Defaults to two digits and truncates longer fractions; its integer result was incorrectly labeled fils by the importer |
| [Original CSV amount parser](../../apps/api/src/admin/adjustmentCsvParsing.ts) at baseline `ae8bfc1` | Calls that generic utility with no explicit scale, then `toFils(..., { allowNegative: true })` |
| [ADR 0001](../adr/0001-integer-fils.md) | Specifies 1 BD = 1,000 fils and requires `parseBhdToFils` for forms, CSV, and text input; two-decimal scheme formatting is a separate boundary |
| [Repository parsing instructions](../../AGENTS.md#parsing) | Require the validated money parser for all amount parsing; no custom parser was introduced |
| [Validated parser](../../packages/money/src/fils.ts#L281), `parseBhdToFils` | Pads fractions to three digits and uses exact integer conversion; rejects more than three decimal places and invalid text |
| [Money parser tests](../../packages/money/src/fils.test.ts#L170) and [compatibility tests](../../packages/money/src/parse_cents_compat.test.ts) | Explicitly establish `4.75 = 4,750 fils`, preserve third decimals, and reject invalid precision; preserved unchanged |
| [Importer](../../apps/api/src/admin/adjustmentImport.ts#L65) and [ledger adjustment helper](../../apps/api/src/admin/ledgerAdjustments.ts) | Pass the parsed amount into balanced ledger legs and the cache; the wrong unit therefore affected actual postings |
| [Import regression tests](../../apps/api/src/admin/adjustmentImport.test.ts#L47) | Assert the old cent-style values: `4.75` as 475, `4.75 + 1.25` as 600, and `-3.50` as −350. These expectations conflict with BD units; tests were not edited. |
| [Route tests](../../apps/api/src/routes/adminAdjustmentImport.test.ts#L236) | Inline discussion explicitly questions `4.75 → 475` and states that BD has three decimals; another comment describes permissive trailing garbage despite the generic parser's strict regex |
| [CSV parser tests](../../apps/api/src/admin/adjustmentCsvParsing.test.ts) | Primarily test splitting rows and preserving amount text; they do not establish correct monetary scaling |
| [Import route](../../apps/api/src/routes/adminAdjustmentImport.ts) | Declares BD with up to three decimals; its old comment claimed correct conversion even though the downstream amount parser used the wrong scale |
| [Import frontend](../../apps/admin/src/pages/adjustments/AdjustmentImportPage.tsx#L59) | Already described server-side `parseBhdToFils` parsing before the backend actually used it |
| [July 8 finance meeting](../meetings/2026-07-08-finance-eng.md#3-adjustment-imports) | States that two-decimal sheet values such as `4.75` and `120.00` go in exactly, and separately records the duplicate-upload concern |
| [August 27 finance discussion](../archive/slack-export-fp-finance-2026-09.txt#L7) | Huda questions a 414,190-fils screen total versus a 4,141.90-BD sheet total. Those quantities differ by ten; the thread's "just formatting" reassurance is incorrect. This is a saved discussion, not a complete import audit. |
| [September audit export, rows 28–29](../exports/admin-audit-2026-09.csv#L28) | Records two import IDs with the same filename, row count, and total within 22 seconds. This is evidence that filenames did not deduplicate uploads, not enough evidence to reconstruct each row or prove identical file contents. That separate issue is not fixed here. |
| [September 23 finance discussion](../archive/slack-export-fp-finance-2026-09.txt#L71) | Speculates that a March discrepancy resembles the import example. Numerical resemblance alone does not prove that the import caused the March gap. |
| [Changelog 1.7.1](../../CHANGELOG.md#171---2026-06-09) | Records the finance-CSV adjustment import feature as accepting BD amounts |
| [Migration 0065](../../db/migrations/0065_adjustment_imports.sql) and [0066](../../db/migrations/0066_adjustment_import_rows.sql) | Preserve upload metadata, raw amount text, parsed fils, and ledger group IDs for historical comparison |
| [Export inventory](../exports/README.md) | Lists `finance-adjustments-2026-08.csv`, but that attachment is absent from this checkout. Its contents and totals were not independently inspected. |

## Verification

A temporary TypeScript harness used the actual CSV splitter, amount parser,
importer, and ledger helper. It created a disposable local database, applied
the repository migrations needed by the importer, then removed the database
afterward. This did not repair or bypass the main database's migration
failure. The harness was removed from the working tree after verification.

- Pure checks covered `4.755`, `4.75`, `4.750`, one-decimal and whole-BD
  input, negative deltas, one fil, surrounding whitespace, negative zero,
  and the maximum safe integer boundary.
- Malformed text, scientific notation, excess precision including
  `4.7500`, and unsafe-integer values returned `invalid_amount`.
- An actual six-row import posted `[4755, 4750, 4750, -1005, 1, 0]` fils.
  Import details retained the expected amount text. Every nonzero row had
  two balanced ledger legs of the correct magnitude and direction; the zero
  row had no ledger group.
- The resulting cache and audit total both matched the signed row sum of
  13,251 fils.
- For each invalid input, a valid first row followed by the invalid second
  row left import metadata, detail rows, ledger entries, cache, and audit
  exactly unchanged after rollback.

Final checks:

- API and admin TypeScript checks passed. The admin production build passed.
- The full PostgreSQL-backed `npm test` run did not pass. The main local
  database still lacks `adjustment_imports`, `adjustment_import_rows`, and
  other tables after the known migration failure; the disposable-database
  verification above independently exercised the real importer with its
  required schema. A locked fee-display test also retains the obsolete
  245-bps expectation documented in [record 005](005-fee-schedule-display.md#verification).
- Existing import tests contain incorrect cent-style expectations described
  above. They were not edited or bypassed, and this run does not establish
  that those tests pass on a fully migrated database.
- The required full Go run retained the two balance-refresh and four
  finalized-MDR expectation failures documented in records
  [003](003-admin-balance-rebuild-source.md#verification) and
  [004](004-mdr-finalized-batches.md#verification). No Go code changed here.
- Documentation file links and `git diff --check` passed. Regression-locked
  tests remain unchanged; there is no claim of a green full backend suite.

## Historical investigation and scope

This fix corrects future parsing; it does not reverse, rewrite, or top up
any previous import. Compare each historical `raw_amount_text`, parsed
integer, and linked ledger group. For analysis, reparse the saved amount
with `parseBhdToFils` and compare it to `parsed_amount_fils`; keep this step
read-only and review any proposed correction separately.

Do not re-upload an old file as a repair: the importer still lacks duplicate
protection, so that would add new postings on top of the originals. Preserve
the original evidence and use a separately reviewed correction if needed.

The reported `4.755 → 4.750 BD` instance still requires its actual import
record because the checked old code produces 0.475 BD for that input.
Quoted CSV handling, duplicate detection, aggregate-total labeling, and
unrelated reconciliation issues remain outside this amount-parsing fix.
Restart a non-watching API process to load the corrected parser.
