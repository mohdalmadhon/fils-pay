# 11: Signup had no limits, no password rules, and no record of email ownership

| | |
|---|---|
| **Type** | Security hardening (open findings 4 and 8 in [`docs/cyper/17`](../cyper/17-open-findings.md)) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `apps/api/src/routes/businessProfile.ts:18-46` (`POST /v1/merchants`, public), `apps/api/src/onboarding/signup.ts:45` (password hashed as given). A note in the route already asked about it (`am: signup is public, so anyone can register a second tenant with an existing owner's email`). |

## What was wrong

- **Any password.** One character was accepted, and so was a 1 MB body, which
  argon2 then had to hash.
- **No limit.** One email address, or one script, could open merchants
  without end.
- **Email ownership was never checked.** It wasn't recorded anywhere either.

## How much of a hole was email verification?

Less than it looked. Every login sends an OTP to the account's email and
requires it back. Anyone who signs up with someone else's address can't log in
(in production, where the code isn't echoed), so they can't issue API keys,
create links or reach the money. What remained was squatting merchant names
and no record of who had proved their address. So the fix records the proof,
which the OTP login already provides, rather than adding a second email
round-trip.

## Fix

| # | Commit |
|---|---|
| 1 | `test: signup refuses weak passwords, limits merchants per email, tracks email ownership` (fails before) |
| 2 | `auth: record when a merchant user proves their email (first OTP login)`: migration 0081 adds `merchant_users.email_verified_at` and `signup_attempts` |
| 3 | `onboarding: limit how many merchants one email can open`: 3 per hour per email (case-insensitive), counted under an advisory lock; optional per-IP limit |
| 4 | `onboarding: require 12 to 256 character passwords at signup` |
| 5 | `docs: improvement 11, signup abuse` |

## New settings

| Setting | Default |
|---|---|
| `SIGNUP_MAX_PER_EMAIL` | 3 |
| `SIGNUP_WINDOW_MINUTES` | 60 |
| `SIGNUP_MAX_PER_IP` | 0 (off). Turn on only with `TRUST_PROXY` set. |

## Behaviour change

- `400 weak_password` for passwords outside 12–256 characters.
- `429 too_many_signups` past the limit.
- `merchant_users.email_verified_at` is `NULL` for accounts
  that have never completed a login. The Ops console doesn't show it yet.

## Verified

`signupAbuse.test.ts` (3), plus `app.test.ts`, `otpSafety.test.ts`,
`loginTenantBinding.test.ts` and `kycUploadSafety.test.ts` (which all sign
up): 26/26.
