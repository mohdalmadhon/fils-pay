# 03: The hosted box ran with development security defaults

| | |
|---|---|
| **Severity** | Critical: password-only super admin login on the hosted demo |
| **Status** | Fixed (5 commits, not pushed). **Needs action on the box:** see [After deploying](#after-deploying). |
| **Component** | `apps/api/src/config.ts`, `auth/notifier.ts`, `adminAuth/notifier.ts`, `ops/docker-compose.yml` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

Four things combined:

1. **`ops/.env.docker` never reached a container.** The compose header said
   compose "picks it up automatically". It doesn't. Compose only reads a
   file named `.env`, and only to fill `${...}` in the compose file. There
   was no `env_file:`. So `NODE_ENV=production` in that file did nothing, and
   the API ran with `NODE_ENV` unset. A note in `auth/notifier.ts` said
   "our staging has NODE_ENV unset"; the reply under it said this was fine
   because of `.env.docker`.
2. **Unset or unknown `NODE_ENV` meant development.** `parseNodeEnv` turned
   anything except the three exact strings into `"development"`, so `prod`,
   `Production` and `staging` also did.
3. **The OTP echo-back was on by default outside production.**
   `otpDevExpose` defaulted to `nodeEnv !== "production"`, so every merchant
   and admin login response carried `devOtpCode`. Setting
   `OTP_DEV_EXPOSE=true` was honoured even in production.
4. **The OTP was logged in plain text** whenever `NODE_ENV` wasn't
   `production`.

The seed creates `superadmin@filspay.test` with a password that is in the
repo, and the API port is published.

## Attack

On the hosted box: log in to the admin console with the seed password; the
response contains the OTP, so you are a super admin (impersonate merchants,
adjust balances, run settlement). Cookies were also sent without `Secure`.
Combined with [01](01-login-cross-tenant.md), any merchant account could be
taken over with no password at all.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: config refuses unsafe auth defaults` | Fails before the fix on 3 of 4 cases. |
| 2 | `config: OTP echo-back is opt-in only, and unknown NODE_ENV refuses to boot` | `OTP_DEV_EXPOSE=true` must be set explicitly, and is a boot error in production. Unset `NODE_ENV` is still development (local runs); any other unknown value is a boot error. Removes the built-in webhook key. |
| 3 | `auth: log the OTP code only with the explicit dev opt-in` | Both notifiers follow `otpDevExpose`. Test fails before. |
| 4 | `ops: load .env.docker into the containers and require real secrets` | `env_file: .env.docker` on the api. `WEBHOOK_SECRET_ENCRYPTION_KEY` and `SETTLEMENT_INTERNAL_TOKEN` are required by compose (`${VAR:?}`). Removes the comments promising a built-in key and a `dev-token` fallback, neither of which existed. Docs updated. |
| 5 | `docs: cyper 03, insecure defaults on the hosted box` | This file. |

About the built-in webhook key: `DEV_FALLBACK_WEBHOOK_KEY_B64` decoded to 34
bytes, so the length check always threw and it was never actually used. It is
removed anyway, because the docs advertised it and a "fix" to 32 bytes would
have put a real key in the repo.

## Verified

- `docker compose config` now shows `NODE_ENV: production` on the api, and
  refuses to render without the two secrets.
- `configSecurity.test.ts` (4), `auth/notifier.test.ts` (2) and `app.test.ts`
  (9) pass.

## Change for developers

Local runs no longer get the OTP in the login response unless you ask for it:

```powershell
$env:OTP_DEV_EXPOSE = "true"
```

The dashboard and admin login pages still show the code when it is present.
`scripts/e2e/payment-check.mjs` needs the API started this way.

## After deploying

- Treat the hosted box as compromised until checked. Review `admin_sessions`,
  `admin_audit_log` and impersonation grants since it was first deployed.
- Change the seeded admin and merchant passwords there, or don't run the seed
  on a hosted box at all.
- Rotate the webhook encryption key if it was ever set to a value from the
  repo or docs, and re-encrypt `webhook_endpoints.secret_ciphertext`.
