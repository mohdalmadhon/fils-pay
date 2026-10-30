# Temporary OTP delivery to a private server file

The initial hosted deployment has no email/SMS integration. At the operator's
request, merchant and admin OTP notifiers can deliver codes to `OTP_LOG_FILE`.
Production stays in production mode, with `OTP_DEV_EXPOSE` off: API responses
and normal container logs contain no OTP codes. Verification, expiry, attempt
limits, sessions, and API fields remain unchanged.

The file must be an absolute path outside the web root. The backend creates it
with mode `0600`, refuses symbolic links, non-regular files, multiple hard links,
files owned by another uid, and group/world access. An unavailable or unsafe
file fails delivery and the login request; it never falls back to logging the
code elsewhere. Each JSON line records timestamp, merchant/admin channel,
user id and code. File writes are synchronous and limited to login/resend.

On the hosted server, the host file is `/opt/filspay/private-otp/otp.jsonl`,
bind-mounted at `/app/private-otp/otp.jsonl` in the API container. Its directory
is mode `0700`, owned by the container's uid 1000. Read it through SSH:

```bash
sudo tail -n 10 /opt/filspay/private-otp/otp.jsonl
```

Readers can complete pending logins. This is an interim operator channel,
not a replacement for individual email/SMS delivery. It records expired codes
too; host logrotate limits retention to one daily rotated file, compressed,
with `0600` permissions and no `copytruncate` (the writer opens each time).
Do not ship this file through ordinary application log collection or backups.
Unset `OTP_LOG_FILE` when a real delivery integration replaces it.

References: `apps/api/src/auth/otpFile.ts`, `auth/notifier.ts`,
`adminAuth/notifier.ts`, `config.ts`, `routes/auth.ts`, `routes/adminAuth.ts`;
the existing OTP exposure fix is `docs/cyper/03-insecure-defaults.md`.

Verification: `node --import tsx scripts/verify-otp-file.mjs` passes locally and
inside the deployed Node image. It covers both channels, production exposure
remaining off, leading-zero codes, timestamps, 0600 permissions, normal-log
redaction and rejection of relative/missing/unsafe/link paths. An HTTPS admin
login and OTP verification also passed on the host. Full `npm test` passed
(events 4, money 40, API 548, reporting 12, web 25, root 11), as did Go tests,
type checking and the compiled build. An initial run reused the previous Go
fixture database and hit four reporting fixture failures; rerunning the full
suite on a newly migrated empty database passed without test/code changes.
