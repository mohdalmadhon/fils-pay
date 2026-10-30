# 052: Admin settlement actions accepted impossible dates, reported settlement's "no" as a 500, and hid a logging failure

**Severity:** Low. An operator could send 2026-02-30 to settlement, got
"server error" when settlement refused a request they could fix, and a failed
audit update on MDR recalculation left no trace.

## Where

- `apps/api/src/routes/admin.ts`: `POST /v1/admin/settlement/run-batch` and
  `POST /v1/admin/merchants/:id/mdr-recalculation`
- `apps/api/src/admin/settlementClient.ts`: `callSettlementInternal`

## Why it was wrong

Both routes checked dates with a regex only:

```ts
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
```

so `2026-02-30` and `2026-04-31` went to the settlement service. MDR
recalculation also accepted `from` after `to`.

Every non-2xx answer from settlement became the same error:

```ts
throw new AppError(500, "settlement_run_failed", ...);
```

When settlement refuses the input (for example a business date that is not
allowed yet) nothing ran and the operator can fix the request, so a 500 is
the wrong answer.

The MDR route recorded the call's outcome with
`markAdminAuditOutcome(...).catch(() => {})`. If that update failed, nothing
was logged. The run-batch route right above it logs the same failure.

## How to reproduce

`POST /v1/admin/settlement/run-batch` with `{ "date": "2026-02-30" }`:
before the fix it was passed on to settlement. A 400 from settlement came
back to the operator as `500 settlement_run_failed`.

## Fix

- Both routes use `isIsoCalendarDate` (`apps/api/src/lib/calendarDate.ts`),
  and MDR recalculation needs `from` before `to`. Bad input is a 400 before
  any audit row or settlement call.
- A 4xx from settlement is now `400 settlement_rejected_request` with
  settlement's reason. 401, 403 and 404 still give `500 settlement_run_failed`,
  because they mean our own token or URL is wrong, which the operator can't fix.
- The MDR route logs a failed outcome update through `request.log.error`, like
  run-batch does.

The existing test "a non-2xx response is a 500 settlement_run_failed" in
`apps/api/src/admin/settlementClient.test.ts` asserted that a 400 from
settlement becomes a 500, which is the behaviour this fix changes. It now
covers 401/403/404/500 only, and the 4xx case has its own test.

## Test

- `apps/api/src/routes/admin.test.ts`: "settlement run-batch and mdr
  recalculation refuse dates that don't exist, and mdr needs from before to"
  (got 200 and called settlement before the fix), and "settlement run-batch:
  settlement refusing the request (4xx) is a 400 to the operator"
- `apps/api/src/admin/settlementClient.test.ts`: "a 4xx from settlement (it
  refused the input) is a 400 settlement_rejected_request carrying its
  reason" (got 500 before the fix)

The logging change has no test: the swallowed update failure is hard to
trigger from a route test.
