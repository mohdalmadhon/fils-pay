# 060: "View as merchant" lands on the merchant login page

**Severity:** High. Support staff could not open a merchant's dashboard at
all, so "View as merchant" did nothing useful.

## Where

`apps/api/src/routes/auth.ts`, the `GET /v1/auth/me` handler. The dashboard
side is `apps/web/src/auth/DashboardAuthContext.tsx` (`refresh`) and
`apps/web/src/auth/RequireDashboardAuth.tsx`.

## Why it was wrong

The admin console starts a grant with
`POST /v1/admin/merchants/:id/impersonate`. That sets only the
`fp_impersonation` cookie, then opens the dashboard in a new tab. The
dashboard asks `GET /v1/auth/me` whether anyone is signed in. That route
used the old session check, which reads only the merchant cookie `fp_sid`:

```ts
app.get("/me", { preHandler: requireSession }, ...)
// requireSession:
const token = request.cookies[request.server.config.cookieName];
if (!token) throw new UnauthorizedError("unauthenticated");
```

So `/me` answered 401, the dashboard set its status to "anonymous", and the
guard sent the operator to `/dashboard/login`. Only `requireMerchantAuth`
(used by the data routes) knows about the grant cookie. The dashboard also
had no banner for this case, because a comment said impersonation "does not
exist in the merchant plane".

## How to reproduce

Sign in to the admin console, open a merchant, click "View as merchant".
The new tab shows the merchant login page. With the API directly:
`GET /v1/auth/me` with only the `fp_impersonation` cookie returned 401.

## Fix

`/me` checks the merchant session first, exactly as before, and returns the
same body. If there is no valid session, it looks up the grant cookie with
`lookupImpersonationGrant` (the same lookup `requireMerchantAuth` uses) and
returns the merchant, the role the grant gives (`support`, or `owner` for a
super admin), `merchantUserId: null`, `email: null`, and
`impersonation: { grantId, readOnly }`. The dashboard's `DashboardMe` type
allows the nulls, and `DashboardLayout` shows a "Viewing as <merchant>"
banner above every page while `impersonation` is set.

## Test

`apps/api/src/routes/authMeImpersonation.test.ts`: "GET /v1/auth/me accepts
a view-as-merchant grant cookie alone". Before the fix it got 401 instead of
200. A second test checks that no cookie, or an unknown grant, is still 401.
