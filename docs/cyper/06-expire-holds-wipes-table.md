# 06: The nightly hold cleanup deleted every hold on a quiet night

| | |
|---|---|
| **Severity** | High (data integrity) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `scripts/expire_holds.ts`, `scripts/lib/sqlFilter.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

`scripts/expire_holds.ts` runs nightly. It:

1. selected the ids of holds still `active` past `expires_at`, then
2. built `DELETE FROM holds WHERE id = ANY($1)` from that list with
   `buildDelete`.

`buildWhere` skipped an empty array as if the filter were absent. On any night
with nothing expired, the list was empty and the statement became:

```sql
DELETE FROM holds
```

Every hold, active and released, was gone. The DELETE also didn't repeat the
`status = 'active'` check, so a hold captured between steps 1 and 2 was
deleted too. A note there called that "negligible window, fine".

## Impact

No outside attacker is needed; the platform does this to itself. Holds are the
record of authorized-but-not-captured money. Losing them hides which
authorizations are still open.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: expire_holds must never build an unscoped DELETE` | Fails before the fix: the statement is a bare `DELETE FROM holds`. |
| 2 | `scripts: sqlFilter refuses empty arrays and unscoped DELETEs` | Empty arrays throw. `buildDelete` throws without a WHERE. |
| 3 | `scripts: expire_holds is one DELETE with its own predicate` | `DELETE FROM holds WHERE status = 'active' AND expires_at < now()`: no empty list, no race. |
| 4 | `test: expire_holds against Postgres, and correct the hold-expiry note` | Integration test in a rolled-back transaction. Fixes the `authorize.ts` note, which said the job never deletes. |
| 5 | `docs: cyper 06, expire_holds wiped the table` | This file. |

## Verified

`scripts/expire_holds.test.ts` (3) and
`scripts/expire_holds.integration.test.ts` (1) pass.

## Check in production

If this job has run on a real database, look for nights where its log line
said `matched 0 abandoned hold(s), deleted N row(s)` with N > 0. Each such night
emptied `holds`. Rebuild open holds from `transactions` that are `authorized`
and not captured or voided.
