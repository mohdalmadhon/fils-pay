# 007 — Merchant login accepts a pending pre-OTP session

Recorded: 2026-10-29.

Status: implemented locally; verified through real HTTP handlers against a
disposable PostgreSQL database. Production access history has not been
audited, and no production sessions or user records were changed.

## Problem and root cause

The user reported being able to log in without entering an OTP.

The confirmed defect is in merchant-session authentication. Password login
correctly issues a short-lived session with `authenticated = false` and a
pending OTP challenge. However, the shared protected-session lookup queried
`live_sessions` using only the token hash.

The view's name was misleading as an authorization shortcut: migration 0058
filters out expired and revoked sessions but includes both pending and
OTP-verified sessions. Selecting a row from it therefore proved only that
the token existed and had a live lifetime, not that OTP was complete.

Both `requireSession` and the session-cookie branch of `requireMerchantAuth`
use `lookupSession`. The omission therefore affected `/v1/auth/me` and
merchant routes protected by those guards, including financial writes. It
was a server-side authorization defect, not just a frontend routing issue.
The dashboard obtains its authenticated state from `/v1/auth/me`, so a
browser navigation or reload could accept the pending cookie without the
OTP form ever being completed.

The separate admin-session lookup already checks `authenticated = true`.
The same bypass was not reproduced on the admin login path.

## Fix and affected lines

The merchant lookup now reads the base `sessions` table and requires the
complete authentication predicate:

```sql
WHERE s.token_hash = $1
  AND s.authenticated = true
  AND s.revoked_at IS NULL
  AND s.expires_at > now()
```

This enforces the distinction between a valid pending challenge token and
an authenticated session at the shared server boundary. Existing pending
lookup remains available to OTP verification and resend endpoints, and the
successful OTP flow still promotes the session normally.

| Location | Change or role |
|---|---|
| [sessions.ts:77](../../apps/api/src/auth/sessions.ts#L77), `lookupSession`, lines 77–99 | Document the complete predicate, replace the view with `sessions`, and explicitly require OTP completion, no revocation, and an unexpired lifetime |
| [middleware.ts:30](../../apps/api/src/auth/middleware.ts#L30), `requireSession` | Unchanged; now receives no authenticated context for a pending cookie |
| [requireMerchantAuth.ts:46](../../apps/api/src/auth/requireMerchantAuth.ts#L46), cookie branch | Unchanged; now rejects pending cookies as merchant sessions |
| [Architecture security section](../ARCHITECTURE.md#security) | Clarify that being in `live_sessions` does not establish authentication |

Historical migrations, locked tests, token generation, OTP generation,
admin authentication, API-key authentication, and impersonation behavior
were not modified. No frontend-only OTP gate was substituted for the
server check.

## References and earlier mentions

Pre-fix source is available with `git show 6199f9f:<path>` for the paths
below. These are the substantive references found during the investigation.

| Reference | What it establishes |
|---|---|
| [Architecture security contract](../ARCHITECTURE.md#security) | Specifies password followed by OTP and that pending sessions grant nothing |
| [Session migration 0012](../../db/migrations/0012_sessions.sql#L1) | Explicitly requires every authenticating query to check `authenticated = true`, revocation, and expiry; pending cookies are lookup keys only |
| [View migration 0058](../../db/migrations/0058_live_sessions.sql) | Defines `live_sessions` as unrevoked/unexpired rows and exposes, but does not filter, the authentication flag |
| [Merchant sessions](../../apps/api/src/auth/sessions.ts), baseline `6199f9f` | Creates pending rows as false, promotes them after OTP, but omits the flag check when resolving a protected session through the view |
| [Merchant login route](../../apps/api/src/routes/auth.ts#L47) | Returns `otpRequired` and a pending cookie after password verification; OTP verification checks the challenge before calling `promoteSession` |
| [Pending-session lookup](../../apps/api/src/auth/sessions.ts), `lookupPendingSession` | Requires `authenticated = false` and is intended only for OTP verification/resend; it remains separate from authenticated lookup |
| [Legacy session middleware](../../apps/api/src/auth/middleware.ts) and [merchant auth middleware](../../apps/api/src/auth/requireMerchantAuth.ts) | Share the defective lookup, explaining why the bypass affected more than the login screen |
| [Dashboard auth provider](../../apps/web/src/auth/DashboardAuthContext.tsx#L41) | Trusts the server's `/v1/auth/me` answer to select authenticated UI state; local storage stores only the merchant ID |
| [Dashboard login page](../../apps/web/src/pages/dashboard-login/LoginPage.tsx#L13) | Presents separate credentials and OTP steps, but cannot enforce an absent server authorization check |
| [Session tests](../../apps/api/src/auth/sessions.test.ts#L78) | An inline comment identifies the missing not-promoted-session test. The reply points to `routes/auth.test.ts`, which is absent in this checkout. Existing tests cover promoted, unknown, revoked, and expired tokens. |
| [Application auth tests](../../apps/api/src/app.test.ts#L80) | Exercise password followed by OTP in the happy path; that flow does not prove that access before OTP is denied |
| [Admin session implementation](../../apps/api/src/adminAuth/sessions.ts), `lookupAdminSession` | Already requires the authenticated flag, revocation, expiry, and active admin status; remains unchanged |
| [Admin route test](../../apps/api/src/routes/admin.test.ts#L206) | Explicitly tests that a pending admin cookie authenticates nothing; this does not cover merchant-session lookup |
| [Admin session migration 0033](../../db/migrations/0033_admin_sessions.sql#L1) | States the same pending-versus-authenticated distinction for the separate admin plane |

The defect was reproduced with synthetic login credentials. No saved
production audit evidence establishing the extent of pre-OTP access was
found or inferred from these code references.

## Verification

A temporary harness created a disposable local database using the relevant
repository migrations, built the real Fastify application, and exercised
its actual login and OTP handlers with synthetic merchant/admin accounts.
It removed the database afterward and was removed from the working tree;
regression-locked test files remain unchanged.

- Correct merchant password returned an OTP-required response and a cookie.
  The stored session remained `authenticated = false` and was visible in
  `live_sessions`, demonstrating why the former lookup accepted it.
- With that pending cookie, `/v1/auth/me`, transaction listing, and a
  transaction capture request returned 401. Probes using the actual legacy
  session guard and merchant owner-write guards also returned 401.
- Missing OTP returned 400; an incorrect code returned 401. Neither granted
  access, and pending lookup still resolved the challenge as intended.
- Correct OTP returned 200, promoted the session, and enabled `/v1/auth/me`
  and both authenticated guard paths. The session no longer resolved as a
  pending challenge.
- A subsequently revoked or expired authenticated session returned no
  lookup result and could not access `/v1/auth/me`. Unknown tokens failed
  closed too.
- Admin password-only login remained blocked until its own OTP was verified.
  Merchant and admin cookies did not cross-authenticate.

Full-suite and type-check results are recorded after the final checks.

## Scope and activation

This change closes the confirmed merchant pre-OTP session bypass. It does
not change session token rotation, OTP retry/resend concurrency, recipient
selection across merchants sharing an email, or browser cookie lifetime.
Those behaviors are separate from the missing authentication predicate.

Pending tokens already issued by an old instance will fail protected
session lookup when evaluated by the corrected code; users can still
complete valid OTP challenges. API instances must load the new code before
the guard is effective. No automatic session purge or production deployment
is included, and legitimate API keys remain an independent authentication
method rather than being subjected to browser OTP.
