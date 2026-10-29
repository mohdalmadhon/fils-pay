# Fix report: admin status recompute switched test merchants to live

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Critical. A sandbox merchant became a live one with no one deciding it. From then on settlement batched its test transactions, charged MDR on them and **paid them out**. |
| **Component** | `apps/api/src/routes/adminMerchantsRecompute.ts`, `apps/api/src/admin/merchantFlags.ts` (removed), `apps/api/src/admin/transactionStatusRecompute.ts` |
| **Reported** | "What happens to test merchants when certain admin tools run?" |
| **Date** | 2026-10-29 |

## Summary

**Recompute transaction statuses** is documented as a tidy-up: re-derive
each transaction's status from its captured/refunded amounts. It also did a
second, undocumented thing, `reconcileSandboxFlag`. If the merchant had
transactions and **no open authorizations**, it set
`merchants.test_mode = false`.

The open-authorization count could never be anything but 0. The candidate
query excludes `status = 'authorized'`, and the count was taken by checking
`row.status === "authorized"` on those same rows. So **every test merchant
with at least one non-authorized transaction** was made live by this tool.

The settlement service's only test-merchant guard is `test_mode = false`
(`apps/settlement/internal/settlement/batch.go`, in both the merchant
list and the fee lookup). From the next daily close onward, the former
sandbox merchant's transactions were closed into batches and paid out.

## Where it was found

- `routes/adminMerchantsRecompute.ts` called
  `reconcileSandboxFlag(client, merchantId, recompute)` after the recompute.
  It was recorded only as `flagsUpdated: ["test_mode"]` in the audit
  metadata.
- `admin/merchantFlags.ts`: `UPDATE merchants SET test_mode = false`.
- `admin/transactionStatusRecompute.ts` selected
  `WHERE status NOT IN ('authorized', 'voided')`, then ran
  `if (row.status === "authorized") openAuthorizations += 1`, which is never true.
- `docs/ADMIN.md` describes the tool as "tidies up transaction statuses…
  Safe to run more than once", with no mention of test mode.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `admin: status recompute no longer switches test merchants to live` | The route no longer touches merchant flags. `merchantFlags.ts` is deleted. `flagsUpdated` stays in the response (always `[]`) so the admin console keeps working. |
| 2 | `admin: count open authorizations in the status recompute correctly` | Counted with their own query. The number is still reported, but it no longer decides anything. |
| 3 | `db: report test merchants the status recompute made live` | `db/reports/test-merchants-made-live-by-recompute.sql`, read-only. Uses the audit log to list each affected merchant, who ran it and when, whether it is still live, and what was settled and paid for it since. |
| 4 | `test: a status recompute never makes a test merchant live` | `adminRecomputeTestMode.test.ts` (3 tests), plus shared fixtures in `src/testing/adminFixtures.ts`. |
| 5 | `docs: recompute test-mode fix report` | This report, plus a note in `ADMIN.md`. |

Why remove it rather than fix the count: switching a merchant from sandbox to
live changes whether real money moves. That has to be a deliberate,
separately audited action, not a side effect of a status tidy-up. A
correct count would still make merchants live without anyone choosing to.

## Verification

- `adminRecomputeTestMode.test.ts`: 3/3 pass. Against the old code, 2 fail:
  the test merchant ended up `test_mode = false`, and `openAuthorizations` was 0
  with 2 open.
- `tsc --noEmit` is clean.

## Deploying / cleanup

1. Deploy.
2. Run `db/reports/test-merchants-made-live-by-recompute.sql` on production.
   For each listed merchant that really is a sandbox account, set
   `test_mode = true` again. Have finance reverse anything in
   `paid_out_fils_since`.

## Related, not changed here

- There is still no explicit, audited admin action to take a merchant out of
  test mode. If one is needed, it should be its own super_admin-only route.
