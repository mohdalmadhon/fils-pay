# 051: Admin logout stopped view-as sessions without recording that they ended

**Severity:** Low. The audit log showed view-as sessions that started but
never ended, and the grant rows still looked open (`ended_at` empty).

## Where

`apps/api/src/routes/adminAuth.ts`, `POST /v1/admin/auth/logout`.

## Why it was wrong

Logout cut off the admin's live "view as merchant" grants with a bare update:

```ts
await app.db.query(
  `UPDATE admin_impersonation_grants
      SET revoked_at = now()
    WHERE admin_user_id = $1 AND revoked_at IS NULL AND ended_at IS NULL AND expires_at > now()`,
  [auth.adminUserId],
);
```

The normal end path (`endImpersonation` in
`apps/api/src/admin/impersonation.ts`) sets `ended_at` and writes an
`impersonation_end` audit row. Logout did neither, and it ran outside any
transaction with the session revoke.

## How to reproduce

As an admin, start viewing as a merchant, then log out. Before the fix the
grant row had `ended_at = NULL` and there was an `impersonation_start` audit
row with no matching `impersonation_end`.

## Fix

Logout now runs in one transaction: it revokes the admin session, sets both
`revoked_at` and `ended_at` on each live grant, and writes one
`impersonation_end` audit row per grant with `{ grantId, reason: "logout" }`.

## Test

`apps/api/src/routes/sessionRotation.test.ts`: "admin logout closes each live
view-as grant like ending it: ended_at set and an impersonation_end audit
row". Before the fix `ended_at` was null.
