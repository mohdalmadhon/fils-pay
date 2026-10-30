# 02: Reporting let one merchant read another merchant's transactions

| | |
|---|---|
| **Severity** | Critical |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/reporting/scope.ts`, `apps/api/src/routes/reporting.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

`GET /v1/reporting/transactions?filter={...}` lets a parent merchant report
on its split children. The filter's `merchantId` went through
`resolveReportMerchantId`, which only checked that the ID was **some**
parent's split child:

```sql
SELECT 1 FROM merchant_split_children WHERE child_merchant_id = $1
```

It never checked that the parent was the caller. The comment in
`transactionsReportQuery.ts` said the merchant was "always overwritten" by the
route, which wasn't true.

Separately, `GET /v1/reporting/export-summary` had no auth preHandler. It read
`request.merchantAuth!` directly, so today it throws (500 for everyone). One
refactor that gave `merchantAuth` a default would have made it an
unauthenticated data read.

## Attack

Any authenticated merchant (any role, or an API key) sends
`filter={"merchantId":"<split child id>"}` and gets up to 500 of that child's
transactions: amounts, references and status. Child IDs are UUIDs, but they
show up in admin screens, support tickets and exports.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: a merchant may report only on itself or its own split children` | 2 of 4 cases fail before the fix. |
| 2 | `reporting: only report on your own merchant or your own split children` | Adds `AND parent_merchant_id = <caller>`. Any other ID is now 403, not silently swapped for the caller. |
| 3 | `test: reporting routes refuse other merchants and anonymous callers` | HTTP-level: 403 for the attacker, 200 for the real parent; export-summary 500 before the fix. |
| 4 | `reporting: require merchant auth on export-summary` | Adds `requireMerchantAuth`; anonymous is now 401. |
| 5 | `docs: cyper 02, cross-tenant reporting read` | This file. |

## Verified

`reporting/*.test.ts` (13) and `routes/reportingScope.test.ts` (2) pass.

## Behaviour change

A filter naming a merchant the caller can't see used to return the caller's
own report. It now returns `403 forbidden_merchant`. Neither web app sends
`merchantId` in this filter, so nothing in the UI changes.
