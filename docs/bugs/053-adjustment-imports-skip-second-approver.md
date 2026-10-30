# 053: Adjustment imports post any amount with no second person

**Severity:** Medium. One finance admin could move unlimited real money,
while the same person can't post a single credit over 50 BD alone.

## Where

- `apps/api/src/admin/adjustmentImport.ts`, `applyAdjustmentImport`.
- `apps/api/src/routes/adminAdjustmentImport.ts`,
  `POST /v1/admin/adjustment-imports`.

## Why it was wrong

Credits have a two-person rule: above 50 BD, a different admin must
approve (`creditThreshold.ts`, `assertDistinctApprover`). An adjustment
import posts real `merchant_payable` ledger entries too, yet every row was
posted the moment the CSV arrived, whatever the total. The audit
reproduced it: a finance admin uploaded a `250000.000` row and got
`201, totalPostedFils: 249999000`, with nobody else involved. That makes
the credit limit pointless, because the same money can go through the
import instead.

The first pass left this as "needs a decision", because the route comment
called applying on upload a deliberate choice and the fix needs a schema
change. The decision taken: same rule as credits.

## How to reproduce

As a finance admin, import one row of `250000.000` BD. Before the fix:
201, and the ledger is posted straight away.

## Fix

- **Upload.** Every amount is parsed and every merchant checked first. If
  the import moves at most 50 BD in total, counted on absolute amounts
  (+40 and −20 move 60 BD), it is applied at once, as before: 201, status
  `applied`. If it moves more, the rows are stored with no ledger postings:
  202, status `pending_approval`, audit action
  `adjustment_import_submitted`.
- **Approve.** `POST /v1/admin/adjustment-imports/:id/approve` (finance or
  super_admin) locks the import and refuses the uploader with
  `409 self_approval_forbidden`. It posts every stored row exactly once,
  then marks the import `applied` with the approver and the time. A second
  approve, or approving a rejected import, gets `409 import_not_pending`.
- **Reject.** `POST /:id/reject` (with an optional `note`) marks the import
  `rejected`; nothing is ever posted.
- **Schema.** Migration `0088_adjustment_import_approval.sql` adds
  `status`, `total_fils`, `decided_by_admin_user_id`, `decided_at` and
  `decision_note`. It makes `applied_at` null until the rows are posted,
  and adds checks: applied ⇔ `applied_at` is set, and the decider is never
  the uploader. Existing imports stay `applied`.
- **Admin console.** The import page shows each import's total and status,
  explains the 50 BD rule, and gives finance and super admins Approve and
  Reject buttons on pending imports. `docs/ADMIN.md` describes the rule.

## Test

`apps/api/src/routes/adminAdjustmentImport.test.ts`:

- "an import moving more than 50 BD waits for a second admin, who applies
  it once": 202, no legs, the uploader is refused, support is refused, the
  approval posts 4 legs, approving again adds nothing, and the cache ends
  at the net 20 BD.
- "a rejected import posts nothing and can't be approved afterwards".

Both got 201 before the fix.
