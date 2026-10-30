# 09: Nothing limited sign-in attempts

| | |
|---|---|
| **Severity** | Medium (High together with [01](01-login-cross-tenant.md)) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/routes/auth.ts`, `routes/adminAuth.ts`, new `auth/throttle.ts`, migration `0078_auth_failures.sql` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

- Merchant and admin `/login` could be called without limit, so passwords could
  be guessed online without end.
- The OTP fix capped guesses at 5 **per challenge**. But every new `/login`
  issues a new challenge with 5 new guesses, so a 6-digit code still fell to
  about 200,000 scripted logins. That is what made [01](01-login-cross-tenant.md)
  practical without the dev OTP.
- Fastify had no `trustProxy`. Behind a load balancer, `request.ip` is the
  balancer, so session and audit IPs are useless and any per-IP limit would
  block everyone at once.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: merchant and admin login are throttled after repeated failures` | 4 of 5 cases fail before the fix. |
| 2 | `auth: record failed sign-ins and check a per-account limit` | Migration `0078` (`auth_failures`) and `auth/throttle.ts`. |
| 3 | `auth: throttle merchant login on failed passwords and OTP codes` | Checked before the password. Wrong passwords and wrong OTP codes both count. |
| 4 | `admin auth: throttle admin login, and set the proxy trust explicitly` | Same for admins. New `TRUST_PROXY` setting. |
| 5 | `docs: cyper 09, login rate limit` | This file. |

How it works:

- Each failed password check or wrong OTP code adds a row to `auth_failures`,
  keyed by `sha256("merchant:<merchantId>:<email>")` or
  `sha256("admin:<email>")`.
- Before checking a password, login counts the account's rows in the window.
  At the limit it answers `429 too_many_login_attempts`, **even with the right
  password**.
- Unknown accounts are keyed and throttled the same way, so the limit doesn't
  reveal which accounts exist.
- One account's failures never lock out another account.
- The per-challenge OTP limit (5) is unchanged.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `LOGIN_MAX_FAILURES` | 10 | Failures per account in the window before 429. |
| `LOGIN_FAILURE_WINDOW_MINUTES` | 15 | Window length. |
| `LOGIN_MAX_FAILURES_PER_IP` | 100 in production, 0 (off) otherwise | Failures per client IP. Needs `TRUST_PROXY` behind a load balancer. |
| `TRUST_PROXY` | off | `true`, or a comma list of proxy addresses/CIDRs (preferred). |

## Verified

`loginThrottle.test.ts` (5), `otpSafety.test.ts`, `app.test.ts`,
`admin.test.ts`, `adminRoleChecks.test.ts` and `loginTenantBinding.test.ts`
pass.

## Trade-off

A per-account limit lets someone lock a known account out for 15 minutes by
failing on purpose. That is the usual trade-off. The per-IP limit and the short
window keep it bounded. Alerting on many `auth_failures` for one account is a
good next step.
