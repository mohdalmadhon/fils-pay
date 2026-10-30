# 050: An adjustment import's total cancelled out credits against debits

**Severity:** Low. The confirmation and audit row could say an import posted
0.000 BD when it really moved money both ways.

## Where

`apps/api/src/admin/adjustmentImport.ts`, `applyAdjustmentImport` (the
`totalPostedFils` it returns and writes into the `adjustment_import_applied`
audit row).

## Why it was wrong

The result type documents the total as absolute:

```ts
/** @property totalPostedFils Sum of the absolute row amounts, so always >= 0. */
```

but the loop added the signed amounts:

```ts
total = addFils(total, amountFils);
```

So rows of `+5.000` and `-5.000` reported a total of 0, and a CSV of mostly
debits reported a negative total. The admin page shows this as "posting X in
total", and the audit log keeps it.

## How to reproduce

Import a CSV with rows `5.000`, `-5.000` and `-0.250` for one merchant.
Before the fix `totalPostedFils` was `-250`.

## Fix

Add the absolute value of each row's amount. The admin page
(`apps/admin/src/pages/adjustments/AdjustmentImportPage.tsx`) only displays
the figure, and the existing tests only use positive rows, so nothing else
needed to change.

## Test

`apps/api/src/admin/adjustmentImport.test.ts`: "totalPostedFils sums the
absolute row amounts, in the result and the audit row". It got `-250`
instead of `10250` before the fix.
