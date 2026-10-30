# 04: Webhook URLs could reach internal services (SSRF)

| | |
|---|---|
| **Severity** | High |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/webhooks/transport.ts`, `create.ts`, new `destination.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

A merchant owner, a finance user or an API key picks the webhook URL. Before
the fix:

- `validateWebhookUrl` only checked the scheme (https in production). Comments
  said "https-only in prod is our SSRF protection" and "create.ts blocks
  private hosts". Neither was true.
- The transport was plain `fetch()`. It connected to any address, **followed
  redirects**, and read the whole response body into memory.
- "Send test event" returns the first 2,000 characters of the response, and
  the delivery log keeps them where support users can read them.

## Attack

Register `https://attacker.example/r`, which answers
`302 → http://169.254.169.254/latest/meta-data/iam/security-credentials/...`.
Press "send test event". The API follows the redirect from inside the
network and returns the cloud credentials. The same works for any internal
HTTP service. A large or slow body could also exhaust API memory.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: the webhook transport refuses private hosts, redirects and huge bodies` | Fails before the fix. |
| 2 | `webhooks: add a destination guard for private and internal addresses` | `destination.ts`: blocked ranges (loopback, RFC 1918, CGNAT, link-local/metadata, reserved, multicast, ULA, IPv4-mapped) and `guardedLookup`, which checks the address actually connected to. |
| 3 | `webhooks: deliver with a guarded transport: no private hosts, no redirects, capped body` | Transport rewritten on `node:http(s)` with `guardedLookup`; IP literals checked; redirects never followed; at most 4 KB read. New setting `WEBHOOK_ALLOW_PRIVATE_HOSTS`. |
| 4 | `webhooks: refuse private and local hosts when an endpoint is saved` | Clear 400 at create/update for blocked IPs, `localhost`, `.local`, `.internal`, single-label names (`settlement`, `postgres`) and URLs with credentials. |
| 5 | `docs: cyper 04, webhook SSRF` | This file. |

Checking at connect time (not only at save time) means a hostname whose DNS
later changes to a private address (DNS rebinding) is still refused.

## New setting

| Setting | Default | Notes |
|---|---|---|
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | `true` outside production, `false` in production | Lets local receivers (`http://127.0.0.1:...`) work in development and tests. Setting it to `true` with `NODE_ENV=production` is a boot error. |

## Verified

- `transport.test.ts` (4), `destination.test.ts` (5) and
  `validateWebhookUrl.test.ts` (4) pass, and the transport and URL tests fail
  on the old code.
- `routes/webhooks.test.ts` and `webhooks/*.test.ts` pass, except the
  dispatcher backoff test, which also fails on `main` without these changes.
