# 02: One variable, OTP_DEMO_DISPLAY, switched off the second factor in production with no guard and no warning

**Severity:** Medium. A single environment variable on a real deployment
switches off the second factor for every merchant and every admin,
super admin included, and nothing says so.

**Area:** API configuration, sign-in on both planes.

## How it was tested

With `NODE_ENV=production` and only `OTP_DEMO_DISPLAY=true`, or `=1`, the
api started normally and logged no warning. The tests then logged in:

- the merchant login with the right password returned
  `200 {"otpRequired":true,...,"devOtpCode":"630764"}`;
- the admin login as `superadmin@filspay.test` returned
  `{..., "devOtpCode":"147420"}`.

By contrast, `OTP_DEV_EXPOSE=true` in production is refused at boot unless
`OTP_SHOW_IN_PRODUCTION=true` is also set.

What held up: a code is only ever returned after the right password. A
wrong password, an unknown email, and a resend without a pending sign-in
all return 401 with no code.

## Why it happened

The demo display was added later (`docs/fixes/demo-otp-display.md`) as a
plain boolean, read with `parseBoolEnv(env.OTP_DEMO_DISPLAY, false)`, which
accepts `true` or `1`. It skipped the two-switch guard and the boot warning
that `OTP_DEV_EXPOSE` already had (`docs/cyper/03`), although the effect is
the same: the password alone signs in.

## Fix

- In production, `OTP_DEMO_DISPLAY=true` also needs
  `OTP_SHOW_IN_PRODUCTION=true`. Otherwise the api refuses to start with a
  message naming both variables.
- Only the exact value `true` turns it on (`1` no longer does).
- The boot warning, "sign-in codes are shown on screen", now also appears
  when the demo display is on.
- The places that tell people how to turn it on now name both switches:
  `ops/.env.docker.example`, `ops/README.md`,
  `docs/fixes/demo-otp-display.md`, and the IP-server deployment record.

**For the hosted demo:** if it runs with `OTP_DEMO_DISPLAY=true`, add
`OTP_SHOW_IN_PRODUCTION=true` before the next deploy, or the api won't
start. `ops/remote-deploy.sh` already sets `OTP_SHOW_IN_PRODUCTION=true`
when `SHOW_OTP` is on.

## Test

`apps/api/src/otpDemoDisplayGuard.test.ts`:

- refused alone in production;
- allowed with `OTP_SHOW_IN_PRODUCTION=true`;
- only `true` turns it on.

Two of the three failed before the fix.
