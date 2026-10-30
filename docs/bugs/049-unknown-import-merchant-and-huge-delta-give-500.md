# 049: An unknown merchant in an adjustment CSV, or a huge balance delta, gave a 500

**Severity:** Low. Finance got a server error with no hint which CSV row was
wrong, and a mistyped balance adjustment crashed instead of being refused.

## Where

- `apps/api/src/admin/adjustmentImport.ts`, `applyAdjustmentImport`
  (`POST /v1/admin/adjustment-imports`, route in
  `apps/api/src/routes/adminAdjustmentImport.ts`)
- `apps/api/src/routes/adminBalanceAdjustments.ts`, `parseBalanceAdjustmentBody`

## Why it was wrong

The import route only checked that each `merchantId` looked like a UUID:

```ts
if (!UUID_RE.test(row.merchantId)) { throw new BadRequestError("invalid_csv_row", ...); }
```

A well-formed id of a merchant that doesn't exist went on to the ledger
insert, which failed on its foreign key. The whole import rolled back (good),
but the answer was `500 internal_error` with no row number.

The balance adjustment route checked `Number.isInteger(deltaFils)`.
`Number.isInteger(1e20)` is true, but the money package's `toFils` refuses
anything past `Number.MAX_SAFE_INTEGER`, and that throw became a 500.

## How to reproduce

Upload `merchantId,amount,reason` with a second row whose id is a random
UUID. Before the fix: 500. Or post `{ "deltaFils": 1e20, "reason": "x" }`
to `/v1/admin/merchants/<id>/balance-adjustments`. Before the fix: 500.

## Fix

`applyAdjustmentImport` looks up all the CSV's merchant ids in one query,
inside the import's transaction and before posting anything, and answers
`400 unknown_merchant` with a message like `row 2: no merchant has id ...`.
The balance adjustment check uses `Number.isSafeInteger`, so out-of-range
values are `400 invalid_request`.

## Test

- `apps/api/src/routes/adminAdjustmentImport.test.ts`: "a row naming a
  merchant that doesn't exist is a 400 naming the row, and applies nothing"
- `apps/api/src/routes/adminBalanceAdjustments.test.ts`: "a deltaFils beyond
  the safe integer range is a 400, not a 500"

Both got 500 before the fix.
