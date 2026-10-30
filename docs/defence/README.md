# Technical defence test (2026-10-30)

This was a hands-on security test of FilsPay on `main`. It ran after the bug
sweep (`docs/bugs/`) and the earlier security review (`docs/cyper/`). Three
areas were tested at once, each against its own scratch database seeded with
the demo data:

- **Sign-in and access:** who can see or change data that isn't theirs.
  This covered every route that takes an id, tried across two merchants;
  both sets of roles; "view as merchant"; cookies and logout; cross-site
  request forgery; account enumeration; suspended merchants and revoked
  keys; the one-time code; and the public routes.
- **Leaks:** where card numbers, CVVs, passwords, sign-in codes, API keys
  and secrets end up. The test searched a full `pg_dump`, the real API logs
  and every response for them. It also looked at the error bodies and
  headers in production mode, the built JavaScript bundles, the repository
  and the deploy scripts.
- **Attacks and abuse:** database injection, making the server call internal
  addresses through webhooks, malicious file uploads, formulas in CSV
  exports, scripts injected into the pages, requests built to overload the
  server, extra fields sent to set values a client shouldn't, replayed
  callbacks, CORS, redirects to other sites, and the security headers of the
  hosting.

A finding counts only if it was reproduced. Each one below has its own
document and its own commit, with a test that failed before the fix.

| # | Finding | Severity | Area |
|---|---|---|---|
| [01](01-otp-guesses-beyond-login-limit.md) | Opening sign-ins in advance gave extra one-time-code guesses past the login limit | Medium | Sign-in (both planes) |
| [02](02-demo-code-display-unguarded-in-production.md) | One variable, `OTP_DEMO_DISPLAY`, switched off the second factor in production with no guard and no warning | Medium | Configuration |
| [03](03-payment-link-card-testing.md) | A public payment link could be used to test stolen card numbers without limit | Medium | Checkout |
| [04](04-shared-demo-passwords.md) | Every demo account got the same password, so one demo login opened all of them, super admin included | High (hosted demo) | Deployment |
| [05](05-otp-codes-in-production-logs.md) | The hosted demo wrote every sign-in code to the API's container logs | Low | Deployment, sign-in |
| [06](06-pages-frameable-no-hsts-no-csp.md) | The checkout, dashboard and Ops console pages could be framed by other sites and had no HSTS or CSP | Medium | Hosting (Caddy) |
| [07](07-kyc-documents-world-readable.md) | Uploaded identity documents were stored readable by every user on the server | Low | Onboarding |
| [08](08-card-and-reference-text-unchecked.md) | Card numbers and references accepted any text, including NUL bytes and objects | Low | Payments, payment links |

## Found and not changed

- **The transactions CSV export has no required date range** and builds the
  whole file in memory (`GET /v1/transactions/export`). A merchant can only
  export their own rows, so the risk is a large merchant using a lot of the
  API's memory. Changing the export format is the capacity work's call;
  `docs/perf/2026-10-30-remaining-capacity-fixes.md` deliberately kept one
  buffered response.
- **`docs/exports/*.csv` are still in the repository** and contain seeded
  merchant ids. This is already listed as open in `docs/cyper/17-open-findings.md`.

## Tested and held up

**Card data**
- After authorizing and paying links with full card numbers (approved,
  declined, acquirer error, expired, replayed, malformed), neither the card
  number nor its first 6 or 8 digits nor the CVV appears anywhere in the
  database, the API logs or the responses.
- The idempotency fingerprint covers only amount, reference, expiry and the
  last 4 digits.

**Secrets at rest**
- Sessions, admin sessions, view-as tokens, API keys (sha256), sign-in codes
  (salted) and passwords (argon2id) are stored hashed; webhook secrets are
  encrypted.
- No response carries a hash, a storage path or a secret. The raw API key
  and the webhook secret are shown once, when created.

**Errors and headers**
- In production a 500 is `{"error":"internal_error"}`; no SQL, paths or
  versions appear in error bodies; there is no `x-powered-by` or `Server`
  header.
- API responses carry nosniff, DENY, `frame-ancestors`, no-referrer,
  `no-store` and HSTS.

**Access between merchants**
- Merchant B, with a session or an API key, gets 403 for merchant A's id in
  the path, and 404 for A's transactions, refunds, settlement batches,
  payment links, webhook endpoints and deliveries, and KYC documents.
- Reporting refuses another merchant's id.

**Roles**
- A merchant `support` user is refused every write.
- `finance` is refused owner-only API keys.
- Admin `support` is refused every money-moving or reviewing action.
- Approving your own credit gets `409 self_approval_forbidden`.

**"View as merchant"**
- A support or finance admin's grant is read-only, and every write gets
  403.
- A grant stops working when it expires, when the admin logs out, and when
  the admin is disabled.

**Cookies and cross-site requests**
- Cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in
  production.
- The token is rotated after the code step, and logout revokes it on the
  server.
- CORS answers only listed origins, never `null` or `*`.
- `text/plain` and form posts can't drive writes.

**Account enumeration**
- Wrong password, unknown email and unknown merchant get the same `401`.
- Their timings were 32.9 ms and 34.8 ms, which is not a usable signal.

**Suspensions and revoked keys**
- A suspended merchant's sessions and keys stop at once.
- A revoked API key gets 401 on its next use.

**Public routes**
- The payment-link read returns only what the checkout shows.
- Acquirer callbacks without a valid signature get 401.
- Health returns status and load counters only.

**Injection and uploads**
- **SQL:** every query takes its values as parameters. The dynamic column
  names come from fixed lists.
- **Webhooks calling internal addresses:** every resolved address is
  checked, including the one actually connected to (which stops a DNS
  trick between check and connect). Private, loopback, link-local, metadata
  and IPv6-embedded ranges are blocked, redirects aren't followed, and
  responses are size-capped.
- **KYC uploads:** the file's type is detected from its bytes, and only PDF,
  JPEG and PNG are accepted. Files are stored under their hash (no paths
  from names), served with a fixed type, and their download name is
  cleaned.
- **CSV exports:** formulas are neutralised and fields quoted.

**Scripts in pages, redirects, extra fields, limits**
- Nothing in the dashboard or Ops console inserts raw HTML. A hostile
  merchant name at checkout is shown as text.
- Logins only redirect within the app.
- Request bodies are read field by field; `merchantId`, `role`, `status` and
  `mdrBps` are never taken from them.
- `limit` is capped at 100, and multipart and CSV sizes are capped.
- Amounts past the safe integer range are refused.
- Signed callbacks expire after 300 s and are deduplicated by id.

**Built bundles and the repository**
- No source maps are shipped, and no passwords, keys or internal hosts are
  in the bundles.
- No private keys or real tokens are tracked.
- The deploy keeps its printed secrets in owner-only files.
