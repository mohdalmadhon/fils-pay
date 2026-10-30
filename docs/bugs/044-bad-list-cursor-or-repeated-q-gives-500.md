# 044: A bad page cursor or a repeated ?q= crashed list pages with a 500

**Severity:** Low. A hand-edited or truncated link to page 2 of a list broke
with a server error instead of starting from page 1.

## Where

- `apps/api/src/admin/merchants.ts`, `listMerchantsForAdmin`
  (`GET /v1/admin/merchants`), and `apps/api/src/routes/adminMerchants.ts`
- `apps/api/src/admin/credits.ts`, `listCreditRequests` (`GET /v1/admin/credits`)
- `apps/api/src/webhooks/deliveries.ts`, `listWebhookDeliveries`
  (`GET /v1/merchants/:id/webhook-endpoints/:id/deliveries`)

## Why it was wrong

Each file had its own `decodeCursor`, and all three only checked that the
decoded text had a `|` with something on both sides:

```ts
const createdAt = decoded.slice(0, separatorIndex);
const id = decoded.slice(separatorIndex + 1);
if (!createdAt || !id) return null;
return { createdAt, id };
```

The two halves then went into SQL as `$4::timestamptz` and `$5::uuid`. A
cursor like base64url of `x|y` made Postgres refuse the cast, so the request
failed with 500. The merchant search also did `filters.q.trim()`, and
`?q=a&q=b` arrives as an array, which has no `trim`.

## How to reproduce

`GET /v1/admin/merchants?cursor=eHx5` (that is `x|y`). Before the fix: 500.
Same for `/v1/admin/credits?cursor=eHx5` and the webhook deliveries list.
`GET /v1/admin/merchants?q=a&q=b` also gave 500.

## Fix

One shared `decodeKeysetCursor` in `apps/api/src/lib/keysetCursor.ts`. It
returns null (so the list starts at page 1, as the old comment promised)
unless the cursor is a string whose timestamp looks like Postgres's own
timestamp text with a real date and time, and whose id is a UUID. The three
modules use it. The merchant list route answers a repeated `q` with
`400 invalid_query`.

## Test

- `apps/api/src/routes/admin.test.ts`: "GET /v1/admin/merchants: a malformed
  cursor restarts at page one and a repeated ?q is a 400"
- `apps/api/src/routes/adminCredits.test.ts`: "GET /v1/admin/credits: a
  malformed cursor restarts at page one instead of a 500"
- `apps/api/src/routes/webhooks.test.ts`: "GET deliveries list: a malformed
  cursor restarts at page one instead of a 500"

All three got 500 before the fix.
