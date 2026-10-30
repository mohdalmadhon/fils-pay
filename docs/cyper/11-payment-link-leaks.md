# 11: Public payment links leaked API key data, and their tokens were logged

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/paymentLinks/read.ts`, `app.ts`, new `lib/logRedaction.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

**1. The public read returned API key data.**
`GET /v1/payment-links/:token` needs no login. It returned, for the merchant's
newest live API key:

- `merchantPublicKey`: the key prefix, `fp_live_` plus the first 8 random
  characters of the raw key;
- `merchantIntegrationId`: the key's **sha256 verifier** (`api_keys.key_hash`),
  the exact value the API compares against to authenticate the key.

The DTO's own comment said it "contains nothing that identifies or
authenticates the merchant". The existing test even asserted the prefix was
there. Keys are 192-bit random, so the hash can't be cracked today, but any
weak, seeded or imported key would fall offline. The response also revealed
live vs test mode and when keys were rotated. Neither web app used the fields.

**2. Payment link tokens were written to the request logs.**
Fastify logs every request's full URL. On the public routes, the URL is
`/v1/payment-links/<token>/...`, and the token is the link's only credential:
anyone with it can open and pay the link.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: the public payment-link read carries nothing about API keys` | Replaces the assertion that pinned the leak. Fails before the fix. |
| 2 | `payment links: stop returning API key data from the public read` | Drops the `api_keys` join and both fields. |
| 3 | `test: payment link tokens never appear in request logs` | Fails before the fix. |
| 4 | `api: redact payment link tokens from request logs` | `requestLogSerializer`: method, URL with `[redacted]` for the token, host, client address, no headers. |
| 5 | `docs: cyper 11, payment link leaks` | This file. |

## Verified

`paymentLinks.test.ts` (8) and `logRedaction.test.ts` (3) pass. A real test run
logs `"url":"/v1/payment-links/[redacted]/pay"`. `apps/web` typechecks.

## After deploying

Existing logs still contain tokens for links created before this change.
Links that are still active can be cancelled and re-sent if the logs were ever
shared outside the team.
