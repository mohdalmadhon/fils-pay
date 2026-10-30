# 18: Follow-ups from an independent review of these fixes

| | |
|---|---|
| **Severity** | Medium (the login-limit bypasses undid most of [09](09-login-rate-limit.md)) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/auth/throttle.ts`, `routes/auth.ts`, `routes/adminAuth.ts`, `webhooks/destination.ts`, `reporting/scope.ts`, `onboarding/kyc.ts`, `ops/docker-compose.yml`, migrations `0078`, `0079` |
| **Found** | A reviewer that hadn't seen the work read the finished diff, 2026-10-30 |

## What the review found, and what was done

| Finding | Real? | Done |
|---|---|---|
| **Login limit bypass by UUID spelling.** The merchant id was hashed as typed, and Postgres accepts the same UUID in upper case, with braces or without hyphens, so each spelling had its own budget. | Yes, reproduced | Login takes only a canonical UUID and lower-cases it; other spellings are a 401 with no password check. |
| **Login limit bypass by parallel requests.** Count, then argon2, then insert: a burst all passed the count. | Yes, reproduced (20 parallel guesses all checked against a limit of 4) | The attempt is counted and recorded as a failure in one transaction under a per-account advisory lock, then removed when the password is right. |
| **The compose seed job no longer started**, because the built-in webhook key was removed and the job only got `DATABASE_URL`. | Yes | The seed service gets `WEBHOOK_SECRET_ENCRYPTION_KEY`. It must match the api's key anyway, or the api can't decrypt what the seed wrote. |
| **Per-IP limit on by default in production with `TRUST_PROXY` off**: behind a proxy, 100 failures from anyone would lock out everyone. | Yes | `LOGIN_MAX_FAILURES_PER_IP` now defaults to off everywhere. |
| **Migration 0079 left in-progress rows with card-derived hashes**, and redacting failed rows "breaks retries". | Partly: an old hash can never match the new fingerprint, so retries of old rows fail either way | 0079 (unreleased) now redacts every authorize row. |
| **KYC cleanup could delete a file a concurrent upload of the same content still needs.** | Yes, a narrow race | Cleanup after a failed insert is removed; an orphaned file is harmless. |
| **IPv6 forms that embed IPv4** (`::7f00:1`, `2002:7f00:1::`) passed the SSRF guard. | Yes, low risk (needs a relay) | IPv4-compatible `::/96`, 6to4 `2002::/16` and Teredo `2001::/32` are blocked. |
| Reporting compared merchant ids case-sensitively. | Yes, minor | Compared canonically; a non-UUID is a 403 instead of reaching SQL. |
| The prune query had no `created_at` index. | Yes | Index added to 0078 (unreleased). |
| A compose comment said `env_file` is on every service. | Yes | Corrected (api only). |
| **A receiver that stalls mid-body is counted as delivered.** | Not reproduced: the request errors and the delivery fails | Kept as a regression test. |
| The public payment-link read still shows a suspended merchant's link as payable (paying it is refused). | Yes, cosmetic | Not changed. |

## Commits

| # | Commit | What |
|---|---|---|
| 1 | `test: review follow-ups for the login limit and the SSRF guard` | 3 of 5 cases fail before the fix. |
| 2 | `auth: one failure budget per account, reserved before the password is checked` | Canonical id, lock-and-reserve, per-IP off by default, index. |
| 3 | `webhooks: block IPv6 forms that embed a private IPv4 address` | `::/96`, `2002::/16`, `2001::/32`. |
| 4 | `fix review follow-ups: seed key, 0079 scope, KYC cleanup, report ids` | The remaining items. |
| 5 | `docs: cyper 18, review follow-ups` | This file, and corrections to 09, 10, 12 and the index. |

## About editing 0078 and 0079

Both migrations are new in this branch and haven't been applied anywhere
outside this work, so they were edited in place rather than followed by new
migrations. `db/migrate.ts` skips migrations by name (a comment there says it
stores checksums; it doesn't), so a scratch database that applied the earlier
versions would silently keep them: no `created_at` index, and in-progress
authorize rows not redacted. Recreate such a database, or apply the two
changes by hand.

## Verified

On a new database: migrate (74) and seed pass, `npm run typecheck` is clean,
API tests 516 / 518 (the same 2 that fail on `main`), scripts 10 / 10,
`npm run audit:prod` 0 vulnerabilities, and `scripts/e2e/payment-check.mjs`
**20 passed, 0 failed**.
