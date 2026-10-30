# 08: Suspended merchants kept their sessions, API keys and payment links

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/auth/sessions.ts`, `apiKeys/verify.ts`, `paymentLinks/pay.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

`merchants.status` can be `active`, `suspended` or `closed`. Only login checked
it. After a merchant was suspended, for example for fraud:

- its dashboard sessions kept working until they expired (up to 12 hours);
- its API keys kept authorising charges, **with no time limit**;
- its payment links could still be paid by customers.

Also, `api_keys.revoke_after` (migration 0056) promised that keys "are revoked
by a sweep job once the timestamp passes". No sweep job exists and nothing read
the column. A key scheduled for revocation during a staged rotation never
stopped working.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: a suspended or closed merchant loses access at once` | 4 cases, all fail before the fix. |
| 2 | `auth: a merchant session only works while the merchant is active` | `lookupSession` joins `merchants` and requires `status = 'active'`. |
| 3 | `api keys: refuse keys of inactive merchants and keys past revoke_after` | `verifyApiKey` requires an active merchant and `revoke_after` not yet passed. |
| 4 | `payment links: a suspended or closed merchant can't take payments` | The pay claim requires an active merchant; the answer is `409 merchant_unavailable`, before any authorization. |
| 5 | `docs: cyper 08, suspended merchants kept access` | This file. |

"View as merchant" for admins is unchanged, so support can still look at a
suspended merchant's account.

## Verified

`suspendedMerchantAuth.test.ts` (5), `auth/sessions.test.ts`,
`adminApiKeyRotation.test.ts`, `app.test.ts`, `paymentLinks.test.ts` and
`paymentLinksExpiry.test.ts` pass.

## Behaviour change

- Scheduled key revocation (`revoke_after`) now actually happens, at the time
  set. Check for keys that already have a past `revoke_after` before deploying:
  they will stop working immediately.

  ```sql
  SELECT id, merchant_id, key_prefix, revoke_after FROM api_keys
   WHERE revoked_at IS NULL AND revoke_after <= now();
  ```
