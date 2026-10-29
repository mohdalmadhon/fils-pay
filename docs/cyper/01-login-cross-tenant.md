# 01: Merchant login handed out another merchant's session

| | |
|---|---|
| **Severity** | Critical |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/routes/auth.ts` (`POST /v1/auth/login`) |
| **Found** | Security review, 2026-10-30 |

## What was wrong

Login took `merchantId`, `email` and `password`. It checked the password
against the user in that merchant, which was right. Then it looked the email
up a second time, across every merchant (`findOtpRecipient`: `WHERE email = $1
... LIMIT 1`, no merchant filter, no order), and issued the OTP challenge and
the pending session for whichever row came back.

Emails are only unique per merchant (`UNIQUE (merchant_id, email)`), and
signup is public with no email verification.

## Attack

1. Sign up a new merchant with the victim's email and your own password.
2. Log in to your merchant with the victim's email and your own password.
3. The password check passes against your row. The session is created for the
   victim's row, the older one, which Postgres usually returns first.
4. Wherever the dev OTP is exposed (see [03](03-insecure-defaults.md)), the
   code comes back in the response and you are the victim's owner. In
   production you still need the code, but nothing limited `/login` calls (see
   [09](09-login-rate-limit.md)), and each call gave 5 new guesses.

The victim's password was never needed. Reproduced by the new test: the
session landed in the other merchant.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: merchant login must not cross into another merchant sharing the email` | Fails before the fix. |
| 2 | `auth: bind the login OTP and session to the user whose password was checked` | Uses the `(merchantId, email)` row for the challenge, session and notifier. |
| 3 | `auth: remove findOtpRecipient, the cross-merchant email lookup` | Deleted `auth/users.ts`. |
| 4 | `onboarding: correct the note on per-merchant emails` | The old note said this was verified. |
| 5 | `docs: cyper 01, cross-tenant merchant login` | This file. |

## Verified

`loginTenantBinding.test.ts` (2 tests), `otpSafety.test.ts` and the
`auth/*.test.ts` suites all pass: 22/22.

## Follow-up

- Verify email ownership at signup, so an address can't be claimed by someone
  who doesn't control it.
- Check whether any session was ever created for a user in a different merchant
  from the one in the login request. The `sessions` rows don't record
  the requested merchant, so this can only be estimated from
  `merchant_users` rows that share an email.
