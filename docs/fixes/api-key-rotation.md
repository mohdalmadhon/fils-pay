# Fix report: API key rotation left the old key working

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. Rotating a key is what you do when it leaks. After a "rotation" the leaked key kept authenticating, with no end date. |
| **Component** | `apps/api/src/apiKeys/issue.ts`, `apps/api/src/admin/apiKeys.ts`, `routes/adminMerchants.ts` |
| **Reported** | "There's a key rotation flow that doesn't do what you'd expect." |
| **Date** | 2026-10-29 |

## Summary

**Rotate API key** (`POST /v1/admin/merchants/:id/api-keys/:keyId/rotate`)
issued a new key and linked it to the old one with `rotated_from_key_id`,
but **never revoked the old key**. Both keys worked. Everything around it
says rotation revokes:

- Migration 0037: *"one transaction revokes the old key with reason
  'rotated' and issues the replacement pointing back at it"*.
- `issue.ts`: *"@property rotatedFromKeyId When set, that key is revoked in
  the same transaction"*, and *"the admin rotation path revokes the old key"*.
- The route: *"Atomic rotate: revoke + reissue + audit in one transaction"*.

The comments disagree on why it doesn't. AM says it's *"the 24h grace period
(see ADMIN.md)"*. ADMIN.md has no grace period, and there is no expiry column, so
the old key never stops working. In `admin.test.ts` am calls it an intended
grace period. YA's reply: *"there was never a grace period in the design.
rotation = revoke"*. That test asserted *"the previous key stays active"*.

## Where it was found

- `apps/api/src/apiKeys/issue.ts`, `issueApiKeyInTx`: stores
  `rotated_from_key_id` and does nothing else with it. FH's comment says rotation should call
  `revokeApiKey`; am replies *"it does, around line 47"*. It doesn't.
- `apps/api/src/admin/apiKeys.ts`, `rotateApiKeyAsAdmin`: no revoke.
- `db/migrations/0037`: FH's note *"after an admin rotation the old key still
  authenticates in my test; nothing sets revoked_at on it"*.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `api keys: revoke the old key when a key is rotated` | In the same transaction as the insert: `revoked_at = now(), revoked_reason = 'rotated'`. It refuses if the old key isn't an active key of that merchant. |
| 2 | `admin: rotation reports the old key's revocation` | The response and audit metadata now say when the old key was revoked. The console tells the operator the previous key no longer works. |
| 3 | `db: report rotated API keys that still authenticate` | `db/reports/rotated-api-keys-still-active.sql`, read-only. It lists every key rotated before this fix that still works, and whether it has been used since. It includes the statement that revokes them. |
| 4 | `test: an admin key rotation revokes the old key` | New `adminApiKeyRotation.test.ts` (3 tests). The existing rotation test is inverted: old key → 401, `revoked_reason = 'rotated'`. |
| 5 | `docs: API key rotation fix report` | This report. ADMIN.md now says rotation revokes immediately. |

The two concurrent-rotation cases are safe because the existing
`SELECT … FOR UPDATE` on the old key serializes them. The second one sees
the key already revoked and gets `409 api_key_already_revoked`.

## Verification

- `adminApiKeyRotation.test.ts`: 3/3 pass. All 3 fail against the old code
  (the old key still returned 200, and rotating the same key twice made two
  live replacements).
- `admin.test.ts`: all pass, including the inverted rotation test.
- `tsc --noEmit` is clean for `apps/api` and `apps/admin`.

## Deploying / cleanup

1. Deploy. From now on a rotation cuts the old key off at once, so the
   operator must send the new key straight away. ADMIN.md says so.
2. Run `db/reports/rotated-api-keys-still-active.sql`. Keys with
   `used_after_rotation = true` are still in use. Ask those merchants to
   switch, then revoke them. Revoke the rest now with the `UPDATE` in the
   report.

## Related, not changed here

- If a short overlap window is ever wanted, it needs an `expires_at` on
  `api_keys` and a check in `verify.ts`, not "don't revoke".
