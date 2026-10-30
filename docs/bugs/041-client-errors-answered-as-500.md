# 041: Bad JSON, an oversize body or a wrong Content-Type came back as a 500

**Severity:** Medium. Simple caller mistakes looked like server crashes: the
client got `500 internal_error` and every one was logged as an unhandled error.

## Where

`apps/api/src/plugins/errorHandler.ts`, `errorHandler`.

## Why it was wrong

The handler only knew about `AppError`, schema validation errors and the
multipart file limits. Everything else fell through to:

```ts
request.log.error({ err, ... }, "unhandled error");
reply.code(500).send({ error: "internal_error" });
```

Fastify's own body-parsing errors (malformed JSON, empty JSON body, body over
the size limit, unsupported Content-Type) already carry a 4xx `statusCode`,
but the handler threw it away.

## How to reproduce

`POST /v1/auth/login` with `Content-Type: application/json` and the body
`{"email": "a@b.test",`. Before the fix: `500 {"error":"internal_error"}`.
A 2 MB JSON body gave the same 500 instead of 413.

## Fix

When the error has a numeric `statusCode` from 400 to 499, answer with that
status and `{ error, message }`. The `error` code is `invalid_json`,
`payload_too_large`, `unsupported_media_type`, `invalid_content_length`, or
`bad_request` for anything else. Real server errors still log and return 500.

## Test

`apps/api/src/plugins/errorHandler.test.ts`: "Fastify client errors keep
their 4xx status instead of becoming a 500" (malformed JSON, empty JSON,
oversize body, unknown Content-Type). Before the fix it got 500 for the first
request.
