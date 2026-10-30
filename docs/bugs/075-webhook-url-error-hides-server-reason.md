# 075: Webhook URL errors always say "Enter a full https:// address"

**Severity:** Low. A merchant who entered a full https address with a
password in it, or a private host, was told to enter a full https address,
which they had done, and could not see what was wrong.

## Where

`apps/web/src/api/client.ts`, `describeError` and its `ERROR_MESSAGES`
table.

## Why it was wrong

The API answers `400 invalid_url` for several reasons
(`apps/api/src/webhooks/create.ts`, `validateWebhookUrl`), and puts the
reason in `message` for two of them: "webhook URLs must not contain
credentials" and "webhook URLs must point at a public host".
`describeError` looks up the code first and returns the fixed text, so the
reason was never shown:

```ts
invalid_url: "Enter a full https:// address for the endpoint.",
...
const known = ERROR_MESSAGES[err.code];
if (known) return known;
```

## How to reproduce

Create a webhook endpoint with `https://user:pass@example.com/hook`. The
page says "Enter a full https:// address for the endpoint."

## Fix

For `invalid_url`, `describeError` shows the server's reason when there is
one (a message that is not just the code), as a sentence. Without a reason
it keeps the old hint. `client.ts` now reads `import.meta.env?.` so the
module can be loaded in unit tests outside Vite.

## Test

`apps/web/src/api/describeError.test.ts`: "invalid_url shows the server's
reason when it gives one" (before the fix it got "Enter a full https://
address for the endpoint.") and "invalid_url without a reason keeps the
general hint".
