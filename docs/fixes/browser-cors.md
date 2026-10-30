# Fix report: the dashboards couldn't reach the API ("Failed to fetch")

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. Neither browser app could make a single API call: no login, nothing. Every request failed in the browser with `TypeError: Failed to fetch`. |
| **Component** | `apps/api/src/plugins/cors.ts` (new), `apps/api/src/config.ts`, `apps/api/src/app.ts` |
| **Found** | Logging in to the merchant dashboard at `localhost:5173` after running the stack locally. |
| **Date** | 2026-10-29 |

## Summary

The merchant dashboard (`localhost:5173`) and the admin console
(`localhost:5174`) are separate origins from the API (`localhost:3000`). Both
call it with `fetch(..., { credentials: "include" })`, because they log in with
cookies. For that, a browser requires the API to:

1. answer the **OPTIONS preflight** that comes before any JSON `POST`, and
2. reply with `Access-Control-Allow-Origin: <that exact origin>` and
   `Access-Control-Allow-Credentials: true`.

The API did neither. It had no CORS code of any kind, so the browser blocked
every call before the app could read it. The server logs looked
fine; only the browser refused.

The code claimed otherwise. `apps/web/src/api/client.ts` had FH: *"credentials
include needs allow-credentials CORS on the api. works locally"*, then MK:
*"CORS is locked to the two origins in config. fine"*. There was no such
config. The web `vite.config.ts` has FH's note *"a proxy to :3000 would avoid
the CORS/cookie dance"*, which was never done either. API tests use
`app.inject(...)`, which never goes through a browser, so nothing caught it.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `config: add CORS_ALLOWED_ORIGINS for the browser apps` | Comma-separated exact origins. Defaults to `http://localhost:5173,http://localhost:5174` outside production, and to **none** in production unless set. `*` and anything with a path are rejected at boot. |
| 2 | `api: answer CORS for the dashboard and admin console origins` | `plugins/cors.ts`, registered first. A listed origin gets its own origin echoed back, plus `Allow-Credentials` and `Vary: Origin`. Preflights get `204` with the allowed methods and headers (`Content-Type`, `Authorization`, `Idempotency-Key`). Any other origin gets no CORS headers at all. |
| 3 | `ops: document CORS_ALLOWED_ORIGINS for the browser apps` | Set in `docker-compose.yml`, listed in `ops/README.md`. The false "already configured" comment in the web client is replaced. |
| 4 | `test: the browser apps' origins get CORS, others don't` | `plugins/cors.test.ts`, 6 tests. |
| 5 | `docs: browser CORS fix report` | This report. |

Why not just a Vite proxy: it only helps the local dev servers. Deployed
dashboards would hit the same wall, and the API has to answer CORS for them
anyway.

## Verification

- `cors.test.ts`: 6/6 pass. Without the plugin registered, the 3 tests for
  the app origins fail. The other 3 cover unlisted origins, server-to-server
  calls and the config parsing, and pass either way, as they should.
- `app.test.ts`, `admin.test.ts`, `acquirerCallbacksSignature.test.ts`,
  `otpSafety.test.ts`: 66/66 pass.
- `tsc --noEmit` is clean.

## Using it

Restart the API. Locally nothing needs setting. When deploying, set
`CORS_ALLOWED_ORIGINS` to the real dashboard and admin console origins, for
example `https://dashboard.filspay.bh,https://ops.filspay.bh`.
