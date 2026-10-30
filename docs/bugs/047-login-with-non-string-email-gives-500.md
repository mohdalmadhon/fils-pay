# 047: Login with a number or object as the email crashed with a 500

**Severity:** Low. A malformed login request looked like a server crash on
both the merchant and the admin login.

## Where

- `apps/api/src/routes/auth.ts`: `POST /v1/auth/login`
- `apps/api/src/routes/adminAuth.ts`: `POST /v1/admin/auth/login`

## Why it was wrong

Both routes only checked that `email` and `password` were truthy, then built
the throttle key:

```ts
// auth/throttle.ts
return sha256Hex(`admin:${email.trim().toLowerCase()}`);
```

A number, array or object has no `trim()`, so `{ "email": 5 }` threw a
TypeError and the request ended as 500. A non-string password reached argon2
and failed the same way.

## How to reproduce

`POST /v1/admin/auth/login` with `{ "email": 5, "password": "x" }`, or
`POST /v1/auth/login` with `{ "merchantId": "<uuid>", "email": 5, "password": "x" }`.
Before the fix: 500.

## Fix

Both routes answer `400 invalid_request` when `email` or `password` is not a
string, before the throttle runs. Nothing else in login changed.

## Test

`apps/api/src/routes/loginThrottle.test.ts`: "login with a non-string email
or password is a 400 on both planes, not a 500". It got 500 before the fix.
