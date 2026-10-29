# Fix report: adjustment imports posted a tenth of every amount

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Critical. Every **Import adjustments** row ever applied posted 10% of the amount finance entered. A 120.00 BD correction posted 12.000 BD. |
| **Component** | `apps/api/src/admin/adjustmentCsvParsing.ts`, `apps/api/src/lib/decimal.ts`, `apps/api/src/payments/discountAdjustment.ts` |
| **Found** | While checking "has anyone tried uploading a really large export?" |
| **Date** | 2026-10-29 |

## Summary

Money in FilsPay is integer **fils**, 3 decimal places (1 BD = 1000 fils).
The CSV importer parsed each amount with `parseDecimalMinor(raw)`, whose
`decimals` parameter **defaulted to 2**, i.e. cents:

| CSV amount | Should post | Posted |
|---|---|---|
| `4.75` | 4750 fils | **475** |
| `4.750` | 4750 | **475** (third digit dropped) |
| `4.755` | 4755 | **475** |
| `120.00` | 120 000 | **12 000** |

`CLAUDE.md` says money is "integer cents (1 BD = 100 cents)". That's wrong
(see ADR-0001), and the parser matches the wrong doc instead of the code's
`Fils` type.

## Where it was found

- `apps/api/src/admin/adjustmentCsvParsing.ts`:
  `toFils(parseDecimalMinor(raw), …)`, with no `decimals` argument.
- `apps/api/src/lib/decimal.ts`: `parseDecimalMinor(raw: string, decimals = 2)`.
  It also silently **truncated** extra digits.
- FH's comment in `routes/adminAdjustmentImport.ts`: *"parseAdjustmentCsv
  handles 3dp BD amounts correctly (4.750 -> 4750 fils), Claude checked"*. It
  doesn't.
- The tests locked the bug in. `adjustmentImport.test.ts` and
  `adminAdjustmentImport.test.ts` asserted `4.75 + 1.25 = 600` fils
  (should be 6000) and parsed `4.75` as `475`.
- Same mistake, not yet wired: `parsePromotionalDiscountFils` in
  `discountAdjustment.ts` used `parseFloat(raw) * 100`.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `admin: parse adjustment import amounts as BD with 3 decimals` | Uses `parseBhdToFils` (exact string arithmetic, already in `@filspay/money`). It rejects a 4th decimal instead of truncating. |
| 2 | `lib: stop parsing money with a 2-decimal (cents) default` | `parseDecimalMinor` now requires `decimals` and rejects longer fractions. `parsePromotionalDiscountFils` uses `parseBhdToFils`. |
| 3 | `test: adjustment import amounts are BD, posted as fils` | New `adjustmentAmounts.test.ts` (6 tests). The existing tests that asserted the cents results now assert fils (`600 → 6000`, `475 → 4750`, `350 → 3500`, `500 → 5000`). |
| 4 | `db: report adjustment-import rows posted at a tenth of their amount` | `db/reports/adjustment-import-shortfall.sql`, read-only. Recomputes each row's intended amount from its kept `raw_amount_text` and lists the shortfall per row. |
| 5 | `docs: adjustment import amount fix report` | This report, plus a note in `ADMIN.md`. |

## Verification

- `adjustmentAmounts.test.ts`: 6/6 pass. They fail on the old parser (`4.75` → 475).
- Import, CSV parsing, route and discount tests: 41/41 pass.
- The shortfall report ran against the test database. It listed every row
  earlier test runs had posted short (e.g. `9.99` posted 999, intended 9990).

## Deploying / cleanup

1. Deploy. New imports post the right amounts straight away.
2. **Run `db/reports/adjustment-import-shortfall.sql` on production** and give
   it to finance. Every row it lists posted only 10% of what was entered. The
   difference (`shortfall_fils`) still needs posting. A follow-up import
   with the differences does it, and that import now parses correctly.
   Rows with `had_more_than_3_decimals = true` were invalid input; check them
   by hand.
3. Fix `CLAUDE.md`'s "money is cents" section. It is wrong, and it is how
   this kind of bug keeps getting written.

## Related, not changed here

- Importing the same file twice still posts it twice (no duplicate check). Noted in ADMIN.md.
