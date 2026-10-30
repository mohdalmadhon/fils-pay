# 14: Pre-OTP tokens became full sessions; grants outlived admin logout

| | |
|---|---|
| **Severity** | Low |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/auth/sessions.ts`, `adminAuth/sessions.ts`, `routes/auth.ts`, `routes/adminAuth.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

1. **No token rotation at OTP.** `/login` sets a pending session cookie before
   the second factor. `promoteSession` / `promoteAdminSession` only set
   `authenticated = true`, so that same token became the full session. A
   pending token that leaked before OTP (logs, a shared machine, a fixation
   attempt) turned into a live session as soon as the real user entered the
   code. Classic fixation was mostly blocked because `/login` overwrites the
   cookie, but the window was real.
2. **Merchant cookie lifetime.** The merchant verify route never re-set the
   cookie, so the browser kept the 10-minute pending `Max-Age`. A note in the
   code asked whether this caused the "10 min logouts". It did.
3. **Grants outlived logout.** "View as merchant" grants use their own cookie,
   and the grant lookup doesn't check the admin session. After an admin logged
   out, a grant cookie kept working for the rest of its TTL (up to 15 minutes).

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: OTP verify rotates the session token; admin logout ends grants` | All 3 cases fail before the fix. |
| 2 | `auth: issue a new merchant session token when OTP is verified` | `promoteSession` rotates `token_hash`; verify sets the new cookie at the full session lifetime. Test helpers take the verify cookie. |
| 3 | `admin auth: issue a new admin session token when OTP is verified` | Same for admins. Admin fixtures take the verify cookie. |
| 4 | `admin auth: logging out ends the admin's view-as-merchant grants` | Revokes the admin's live grants and clears the grant cookie. |
| 5 | `docs: cyper 14, session rotation and grant logout` | This file. |

## Verified

`sessionRotation.test.ts` (3) passes. The full API suite: 509 of 511 pass. The
2 failures are the ones already failing on `main`
(`currentFeeScheduleDisplay` and the dispatcher backoff test).

## For clients

Browsers pick up the new cookie automatically. A script that signs in must use
the `Set-Cookie` from `/otp/verify`, not the one from `/login`.
`scripts/e2e/payment-check.mjs` already does this.

Logging out of the admin console also ends any "view as merchant" session that
admin has open, on every device.
