# 06: The checkout, dashboard and Ops console pages could be framed by other sites and had no HSTS or CSP

**Severity:** Medium. The checkout's card form could be framed by another
site, and nothing told the browser to stay on HTTPS.

**Area:** hosting (`ops/Caddyfile`), the pages of the dashboard, checkout and
Ops console.

## How it was tested

Both apps were built the way `ops/Dockerfile.web` builds them, then served
through the real `ops/Caddyfile` with the official Caddy 2.8.4 binary. The
API ran on its own port.

Before the fix, `GET /dashboard`, `/pay/<token>` and the Ops console's `/`
returned only `X-Content-Type-Options` and `Referrer-Policy`:

- no `X-Frame-Options` or CSP `frame-ancestors`, so another site could
  frame the checkout or the Ops console;
- no `Strict-Transport-Security`;
- no `Content-Security-Policy`.

The API's own headers (`apps/api/src/plugins/securityHeaders.ts`,
`docs/cyper/13`) are present on `/v1` responses, but they never reach the
static pages, and the hardening test only checked an API response.

## Fix

The `(app)` snippet, which both sites use, now sends:

| Header | Value | Why |
|---|---|---|
| `X-Frame-Options` | `DENY` | no framing (older browsers) |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | scripts only from the app itself; calls only to its own origin (`/v1` through Caddy), so injected code can't send data elsewhere; no framing |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | browsers stay on HTTPS after the first visit (ignored on plain-HTTP deployments) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | the pages need none of these |

`style-src` allows inline styles because React sets `style` attributes, and
Google Fonts because both `index.html` files load Geist from it. Scripts get
no such exception: the builds have no inline scripts.

## Checked after the fix (same setup)

- Every response carries the four headers.
- **No CSP violations** while signing in to the dashboard (password and
  code), opening every dashboard page, starting the tour, creating a payment
  link, loading its checkout page, and signing in to the Ops console as
  super admin.
- A page on another origin that frames a checkout gets nothing rendered:
  the browser blocks it.

## Test

- `scripts/caddyHeaders.test.ts`, run by `npm test`. It reads
  `ops/Caddyfile` and checks the framing, HSTS and CSP rules (own scripts,
  own connections, no `unsafe-eval`, no objects). It failed on the old file.
- `scripts/e2e/caddy-headers-check.mjs` is the browser check above. Its
  header explains the setup.
