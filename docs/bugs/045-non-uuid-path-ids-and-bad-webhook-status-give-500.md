# 045: A non-UUID id in a merchant URL, or a bad webhook status, gave a 500

**Severity:** Low. A wrong link or a typo in an integration looked like a
server crash instead of "not found" or "bad request".

## Where

- `apps/api/src/routes/webhooks.ts`: every route with `:id` or `:deliveryId`
  (delete, update, test-send, replay, deliveries list, delivery detail)
- `apps/api/src/routes/apiKeys.ts`: `DELETE /:merchantId/api-keys/:id`
- `apps/api/src/routes/kyc.ts`: the KYC document `file` and `thumbnail` routes
- `apps/api/src/webhooks/update.ts`: `updateWebhookEndpoint`

## Why it was wrong

The path ids went straight into SQL, for example:

```sql
SELECT storage_key, mime_type, file_name FROM kyc_documents WHERE id = $1 AND merchant_id = $2
```

The `id` columns are `uuid`, so an id like `nope` made Postgres refuse the
query and the request ended as 500. The admin routes already guard against
this with `assertUuidParam`; these merchant routes did not.

`updateWebhookEndpoint` took `status` from the body without checking it. The
TypeScript type says `"active" | "disabled"`, but the body is client JSON, so
`"paused"` reached the table's CHECK constraint and failed with 500.

## How to reproduce

As a merchant owner, `DELETE /v1/merchants/<id>/webhook-endpoints/nope`, or
`PATCH` a real endpoint with `{ "status": "paused" }`. Before the fix both
gave 500.

## Fix

A shared `assertUuidParam` in `apps/api/src/lib/uuid.ts` throws a 404 with
the route's usual not-found code (`webhook_endpoint_not_found`,
`webhook_delivery_not_found`, `api_key_not_found`, `kyc_document_not_found`,
`kyc_thumbnail_not_found`) for a non-UUID id. The routes above call it before
any query. `updateWebhookEndpoint` answers any status other than `active` or
`disabled` with `400 invalid_status`.

## Test

`apps/api/src/routes/pathIdValidation.test.ts`: "non-UUID ids in webhook, API
key and KYC document paths are 404s, not 500s" and "PATCH webhook endpoint: a
status other than active or disabled is a 400". Both got 500 before the fix.
