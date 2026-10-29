# Fix report: OTP login codes were guessable

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Critical. The second factor for both merchant and **admin** logins could be beaten. Codes were predictable, and the 5-guess limit didn't hold. |
| **Component** | `apps/api/src/lib/random.ts`, `apps/api/src/auth/otp.ts`, `routes/auth.ts`, `routes/adminAuth.ts` |
| **Reported** | "The OTP implementation changed at some point. Is it still safe?" |
| **Date** | 2026-10-29 |

## Summary

No. It had four separate problems:

1. **Predictable codes.** `generateOtpCode` calls `randomDigits`, which used
   `Math.random()`. That generator isn't cryptographic: anyone who sees a
   few of its outputs can predict the rest. `adminAuth/otp.ts` still says codes
   are *"Generated with crypto.randomInt"*, which is how it worked before it
   changed. The same helper (`randomFromAlphabet`) makes **payment link
   tokens**, which are bearer credentials for the public pay page.
2. **The attempt limit was a race.** Verify read `attempt_count`, compared the
   code, and only incremented after a miss. Any number of guesses sent at
   the same moment all read the same count and were **all checked**. In
   the test, 30 parallel guesses got more than 5 checks against a limit of 5. MK
   wrote this in a comment (*"if i fire 50 at once they all read
   attempt_count=0"*). The admin route's comment claims it reads the row
   `FOR UPDATE`; it didn't.
3. **Resend reset the limit.** The resend docstring says the new challenge
   *"inherits the previous challenge's attempt_count"*. It never passed that
   value, so each resend (allowed every 30 s) gave out another 5 guesses.
4. **A code could be used twice.** The consume step had no
   `consumed_at IS NULL` check, so two requests carrying the right code at once
   both logged in.

## Where it was found

- `apps/api/src/lib/random.ts`: `Math.floor(Math.random() * 10 ** n)`.
- `apps/api/src/routes/auth.ts` and `routes/adminAuth.ts`, `otp/verify`:
  SELECT → compare → `UPDATE … attempt_count + 1` on a miss only.
- `routes/auth.ts`, `otp/resend`: `issueChallenge(...)` without the old
  attempt count.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `auth: generate OTP codes and link tokens with crypto.randomInt` | Each digit or character comes from `crypto.randomInt`: uniform, unpredictable, no modulo bias. |
| 2 | `auth: spend an OTP attempt atomically before checking the code` | New `attemptOtp` claims an attempt with one conditional `UPDATE … WHERE attempt_count < max_attempts AND consumed_at IS NULL AND expires_at > now()` **before** comparing. `consumeOtpChallenge` uses the code at most once. Merchant verify uses both. Resend carries the spent attempts over. |
| 3 | `admin auth: spend an OTP attempt atomically before checking the code` | Same for admin login. |
| 4 | `test: OTP codes are unpredictable and the attempt limit holds under load` | `otpSafety.test.ts`, 8 tests. |
| 5 | `docs: OTP safety fix report` | This report. |

Behaviour that stays the same: the wrong-code response is still `401 invalid_code`.
Running out of attempts still revokes the pending session (`429`). An expired
or used challenge is still `410`. A correct code after a few wrong ones still
logs in. The only difference is that the correct guess now also counts as an
attempt, so 5 attempts means 5 checks of any kind.

## Verification

- `otpSafety.test.ts`: 8/8 pass. Against the old code, 6 fail: pinned
  `Math.random` gave identical codes, parallel guesses beat the limit on both
  planes, a code logged in twice, and resend reset the budget. The 2 that
  pass on the old code check normal logins still work.
- Existing auth tests (`auth/*.test.ts`, `app.test.ts`, `admin.test.ts`): all
  pass.
- `tsc --noEmit` is clean.

## Deploying

Nothing to migrate. Pending challenges keep working. Consider ending
sessions created during any window in which you suspect OTP abuse.

## Related, not changed here

- `adminAuth/otp.ts` still describes the old guarantees in places; the code it
  re-exports is now correct.
- There is no per-account or per-IP rate limit on `/login` itself, so
  someone can keep starting new logins (each with a fresh challenge) for as
  long as they know the password.
