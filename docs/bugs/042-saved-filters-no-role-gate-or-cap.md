# 042: Anyone signed in to a merchant could save report filters, with no limit

**Severity:** Low. A merchant "support" user or an admin's view-only "view as
merchant" session could write to the merchant's account, and any caller could
add saved filters without end.

## Where

`apps/api/src/routes/reporting.ts`, `POST /v1/reporting/saved-filters`, and
`apps/api/src/reporting/savedFilters.ts`, `createSavedFilter`.

## Why it was wrong

The route only checked that the caller was signed in:

```ts
app.post("/saved-filters", { preHandler: requireMerchantAuth }, ...)
```

It never called `requireMerchantRole` or `requireMerchantWriterActor`, which
every other merchant write route uses. So a support admin viewing as the
merchant (who `docs/ADMIN.md` says may only look) could save filters. The
list function's comment said a merchant "is capped at 50 saved filters by a
CHECK in the 0061 migration". There is no such CHECK (the table is created in
0069 and has none), so there was no cap at all.

## How to reproduce

Sign in as a merchant user with role `support` and
`POST /v1/reporting/saved-filters` with `{ "name": "x", "filter": {} }`.
Before the fix: 201. Saving 51 filters as the owner also gave 201 every time.

## Fix

The route now needs role `owner` or `finance` (API keys pass, as on the other
write routes) and calls `requireMerchantWriterActor`, so a view-only
impersonation gets `403 impersonation_read_only`. `createSavedFilter` counts
the merchant's filters inside a transaction, under a per-merchant advisory
lock, and refuses the 51st with `409 saved_filter_limit_reached`. The comment
now says where the cap really lives.

## Test

`apps/api/src/routes/reportingSavedFilters.test.ts`: "saved filters: a
merchant support user and a view-only admin session can't save" (got 201
before the fix) and "saved filters: owner and finance can save, up to 50 per
merchant" (the 51st got 201 before the fix).
