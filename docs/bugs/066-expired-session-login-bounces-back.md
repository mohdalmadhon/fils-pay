# 066: After the session expires, the login page bounces back into the dashboard

**Severity:** Medium. Once a session expired, the user saw "Your session has
ended" on every page, but going to the login page sent them straight back,
so they could not sign in again without reloading the browser.

## Where

`apps/web/src/api/client.ts` (`request`),
`apps/web/src/auth/DashboardAuthContext.tsx`, and
`apps/web/src/pages/dashboard-login/LoginPage.tsx`. The admin console has
the same pattern: `apps/admin/src/api/client.ts`,
`apps/admin/src/auth/AdminAuthContext.tsx`,
`apps/admin/src/pages/login/LoginPage.tsx`.

## Why it was wrong

The auth context asks `/me` once, when the app loads, and then keeps
`status: "authenticated"` for good. When a later API call gets
`401 unauthenticated`, `request` only throws an error for that page to
show; nothing tells the auth context. The login page then does:

```tsx
if (status === "authenticated") {
  return <Navigate to={redirectTo} replace />;
}
```

so it sends the user back to the page that just failed.

## How to reproduce

Sign in to the dashboard. Revoke the session (or wait for it to expire).
Open Transactions: "Your session has ended. Sign in again to continue."
Go to `/dashboard/login`: you are redirected to Transactions again.

## Fix

A small module, `api/sessionEvents.ts` (one in each app). `request` calls
`reportApiFailure(status, code)` on every failed response; a
`401 unauthenticated` notifies subscribers. Each auth context subscribes
and switches to `anonymous`. The route guard then sends the user to the
login page with the current page as `from`, so they come back to it after
signing in. A wrong password (`401 invalid_credentials`) does not count.

## Test

`apps/web/src/api/sessionEvents.test.ts` and
`apps/admin/src/api/sessionEvents.test.ts`: "a 401 unauthenticated from the
API tells the auth context the session has ended" and "other failures,
including a wrong password, do not end the session". Before the fix there
was no such signal: nothing outside the failing page heard about the 401.
