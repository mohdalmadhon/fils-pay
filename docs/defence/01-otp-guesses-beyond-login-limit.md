# 01: Opening sign-ins in advance gave extra one-time-code guesses past the login limit

**Severity:** Medium. It turns a stolen password into a likely account
takeover: the second factor's guess limit could be multiplied at will.

**Area:** sign-in, merchant dashboard and Ops console.

## How it was tested

A probe signed in as a seeded merchant owner with the right password six
times, then sent four wrong codes on each of the six pending sign-ins. All 24
were answered `401 invalid_code`, with none refused. After that a fresh login
got `429 too_many_login_attempts`, but the right code on one of the earlier
pending sign-ins still answered `200` and signed in as owner.

A second probe opened 200 pending sign-ins in about 5.5 seconds, which is
1,000 code guesses.

## Why it happened

- Each pending sign-in has its own one-time code challenge with 5 attempts.
- Login reserves a failure before checking the password, and releases it
  when the password is right, so opening a pending sign-in with the password
  cost nothing.
- `POST /otp/verify` only checked the challenge's own attempt count, never
  the account's failure count. So pending sign-ins opened before the account
  hit its limit kept accepting codes after it.
- Opening a new pending sign-in did not end the earlier ones.

## Fix

- **One pending sign-in per user.** Creating a pending session (merchant
  `createPendingSession`, admin `createPendingAdminSession`) first revokes
  the user's other unauthenticated sessions. Each password check now buys
  exactly one set of 5 guesses.
- **The account limit covers codes.** `POST /otp/verify` (both planes) calls
  the new `assertUnderLoginLimit` before comparing the code. When the
  account, or the address, is over its failure limit, it answers
  `429 too_many_login_attempts` and doesn't even check the code. Wrong codes
  were already counted as failures; now they also stop the next guess.

A person who opens the login page in two tabs will find the first tab's code
no longer works. They should sign in from the newest tab.

## Test

`apps/api/src/routes/otpGuessBudget.test.ts`:

- "a new sign-in ends the user's earlier pending sign-ins"
- "once the account is over its failure limit, no pending sign-in accepts a
  code, even the right one"
- the same two checks on the admin plane

Before the fix the old sign-in answered 200 and the over-limit code answered
200.
