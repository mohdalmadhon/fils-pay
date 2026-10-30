# Security review: `cyper` branch, 2026-10-30

A defensive review of the whole FilsPay monorepo: authentication and
sessions, authorization and tenant isolation, injection, uploads, SSRF,
secrets, logging, configuration and deployment, dependencies, and the git
history. Every fixed issue has its own report with the commits, the tests
that fail before and pass after, and anything to do after merging.

**Nothing is pushed.** All commits are on the local `cyper` branch, authored
and committed as `malmadhoo`.

## Fixed

| # | Issue | Severity | Report |
|---|---|---|---|
| 01 | Merchant login handed out another merchant's session (sign up with the victim's email, log in with your own password) | **Critical** | [01-login-cross-tenant.md](01-login-cross-tenant.md) |
| 02 | Reporting let any merchant read another merchant's split-child transactions; an unauthenticated route | **Critical** | [02-reporting-cross-tenant.md](02-reporting-cross-tenant.md) |
| 03 | Hosted box ran with development defaults: OTP echoed in the login response and logged, so super admin with the seed password alone | **Critical** | [03-insecure-defaults.md](03-insecure-defaults.md) |
| 04 | Webhook URLs could reach internal services and cloud metadata, response shown back (SSRF) | High | [04-webhook-ssrf.md](04-webhook-ssrf.md) |
| 05 | View-only users and admins could capture and void; an unsafe refund handler was drafted | High | [05-capture-void-roles.md](05-capture-void-roles.md) |
| 06 | Nightly hold cleanup deleted every hold on a quiet night | High | [06-expire-holds-wipes-table.md](06-expire-holds-wipes-table.md) |
| 07 | Acquirer signing secret committed; Postgres published to the internet with a default password | High | [07-committed-secrets-and-open-database.md](07-committed-secrets-and-open-database.md) |
| 08 | Suspended merchants kept sessions, API keys and payment links; `revoke_after` ignored | Medium | [08-suspended-merchants-keep-access.md](08-suspended-merchants-keep-access.md) |
| 09 | No limit on sign-in attempts (password or OTP) | Medium | [09-login-rate-limit.md](09-login-rate-limit.md) |
| 10 | Card number and CVV recoverable from stored idempotency hashes | Medium | [10-card-data-in-idempotency-hash.md](10-card-data-in-idempotency-hash.md) |
| 11 | Public payment link leaked API key prefix and hash; link tokens logged | Medium | [11-payment-link-leaks.md](11-payment-link-leaks.md) |
| 12 | KYC uploads trusted filenames, decoded images without limits, accepted many files | Medium | [12-kyc-uploads.md](12-kyc-uploads.md) |
| 13 | CSV formula injection, no security headers, crafted input caused 500s | Low | [13-hardening.md](13-hardening.md) |
| 14 | Pre-OTP tokens became full sessions; grants outlived admin logout | Low | [14-session-rotation-and-grant-logout.md](14-session-rotation-and-grant-logout.md) |
| 15 | Vulnerable npm dependencies (sharp high, fastify, fast-uri, react-router) | High | [15-vulnerable-dependencies.md](15-vulnerable-dependencies.md) |
| 16 | AI-agent instruction files recommended insecure code; admin invite codes used `Math.random()` | Medium | [16-unsafe-agent-guidance-and-invite-codes.md](16-unsafe-agent-guidance-and-invite-codes.md) |
| 18 | Follow-ups from an independent review of these fixes: login-limit bypasses, the seed job, IPv6 SSRF forms | Medium | [18-review-follow-ups.md](18-review-follow-ups.md) |

17 reports, each 5 commits: usually a failing test first, then the fix in
steps, then its report. 18 is the round of fixes from an independent review of
the other 16.

## Not fixed

[17-open-findings.md](17-open-findings.md): forged commit identity and
untrustworthy history, production data in `docs/exports/`, the pgx upgrade
that needs Go 1.25, unverified emails, seeded passwords, one database role
for everything, and smaller items.

## Do these after merging

These need someone with access to the hosted box, the acquirer, or the team.
Each report has the details.

1. **Rotate `ACQUIRER_CALLBACK_SIGNING_SECRET`** with the acquirer. The old
   value is in git history. ([07](07-committed-secrets-and-open-database.md#after-merging))
2. **Recreate `ops/.env.docker`** from `ops/.env.docker.example`; pulling
   removes the tracked copy. Create `ops/.env` with `POSTGRES_PASSWORD`,
   `WEBHOOK_SECRET_ENCRYPTION_KEY` and `SETTLEMENT_INTERNAL_TOKEN`
   ([ops/README.md](../../ops/README.md)).
3. **Change the database password** on the hosted box (`ALTER ROLE`); the
   compose variable only applies to a fresh volume.
4. **Treat the hosted box as exposed until checked.** Review admin sessions,
   `admin_audit_log` and impersonation grants since it was deployed. Change the
   seeded passwords. ([03](03-insecure-defaults.md#after-deploying))
5. **Run `npm install`** (sharp and react-router were upgraded) and
   **`npm run migrate`** (0078 `auth_failures`, 0079 redacts old hashes).
6. **Upgrade pgx** on a machine with Go 1.25 ([15](15-vulnerable-dependencies.md#not-fixed-pgx-go-settlement)).
7. **Locally, set `OTP_DEV_EXPOSE=true`** to see the OTP in the login response.
   It is no longer on by default.

## New settings

| Setting | Default | Report |
|---|---|---|
| `OTP_DEV_EXPOSE` | off; refused in production | [03](03-insecure-defaults.md) |
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | on outside production; refused in production | [04](04-webhook-ssrf.md) |
| `LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_MINUTES`, `LOGIN_MAX_FAILURES_PER_IP` | 10, 15, off | [09](09-login-rate-limit.md), [18](18-review-follow-ups.md) |
| `TRUST_PROXY` | off | [09](09-login-rate-limit.md) |
| `NODE_ENV` | unknown values now refuse to boot | [03](03-insecure-defaults.md) |

## Behaviour changes worth knowing

- Logging in by script: use the cookie from `/otp/verify`, not `/login` ([14](14-session-rotation-and-grant-logout.md)).
- A report filter naming another merchant is `403`, not silently your own ([02](02-reporting-cross-tenant.md)).
- Support-role users and view-only admins get `403` on capture and void ([05](05-capture-void-roles.md)).
- API keys past `revoke_after` stop working ([08](08-suspended-merchants-keep-access.md)).
- CSV references starting with `= + - @` get a leading `'` ([13](13-hardening.md)).

## Existing tests that were changed

`AGENTS.md` asks agents not to change existing tests. These were changed
because they asserted the insecure behaviour, or depended on it:

| Test | Why |
|---|---|
| `routes/paymentLinks.test.ts` | Asserted that the public link read returned the API key prefix: the leak in [11](11-payment-link-leaks.md). |
| `payments/idempotency.test.ts` | Hashed a body with `pan`/`cvv`, which `hashRequest` now refuses ([10](10-card-data-in-idempotency-hash.md)). |
| `app.test.ts`, `routes/admin.test.ts`, `routes/adminBalanceAdjustments.test.ts`, `routes/adminCredits.test.ts`, `routes/adminAdjustmentImport.test.ts`, `testing/adminFixtures.ts` | Kept using the pre-OTP cookie after verify; now take the rotated one ([14](14-session-rotation-and-grant-logout.md)). |
| `routes/webhooks.test.ts` | Calls the transport with `allowPrivateHosts: true` for its local receiver ([04](04-webhook-ssrf.md)). |
| `onboarding/kycThumbnail.test.ts` | Type import for sharp 0.35 ([15](15-vulnerable-dependencies.md)). |

No assertion about money, fees, ledger or settlement was changed.
`packages/money` and `apps/settlement` were not touched.

## How it was reviewed

1. Three parallel reviews of the code, each limited to a few areas (auth and
   sessions; authorization, injection, uploads and SSRF; frontend, secrets,
   logging and ops), plus a review of the git history.
2. Every finding was checked against the code before fixing. Two review
   findings disagreed (whether the built-in webhook key worked). It didn't:
   it decoded to 34 bytes, so the API could never boot with it.
3. Each fix starts with a test that fails on the old code.
4. `npm audit` and advisory lookups for dependencies.
5. An independent review of the finished diff, by a reviewer that hadn't seen
   the work. Its real findings are fixed in [18](18-review-follow-ups.md).
6. Full verification at the end; see below.

## Verification results

All on a new, empty Postgres 16 database, after the review follow-ups (18).

| Check | Result |
|---|---|
| `npm run migrate` on an empty database | 74 migrations applied (72 + `0078`, `0079`) |
| `npm run seed` | all assertions pass |
| `npm run typecheck` (all workspaces, `db`, `scripts`) | clean |
| API tests | 516 / 518. The 2 failures also fail on `main`: `currentFeeScheduleDisplay` ("most recently entered schedule") and the dispatcher backoff test. |
| Scripts tests | 10 / 10 |
| `packages/money`, `packages/events`, web | 40 / 40, 4 / 4, 8 / 8 |
| Reporting | 7 / 11, the same 4 that fail on `main` |
| Settlement (Go) `go vet` + `go test ./...` | all packages pass except the same 4 `TestRecalculateMDR_*` that fail on `main` |
| `npm run audit:prod` | 0 vulnerabilities |
| `scripts/e2e/payment-check.mjs` against a real API process | **20 passed, 0 failed**: login, OTP, link, payment, ledger, fees, settlement, payout, signed webhooks, reconciliation gap 0 |
| API request log during that run | link tokens logged as `/v1/payment-links/[redacted]/pay` |
| `docker compose config` | api gets `NODE_ENV=production`; Postgres bound to `127.0.0.1`; refuses to render without the required secrets |
