# 05: The hosted demo wrote every sign-in code to the API's container logs

**Severity:** Low. Using a code also needs the pending sign-in's cookie, and
on the demo the code is on screen anyway. But log files are kept, copied
and shipped, and the project's own note promises no codes in them.

**Area:** deployment and sign-in on both planes.

## How it was tested

The API was started with the settings `ops/remote-deploy.sh` writes:
`NODE_ENV=production`, `OTP_DEV_EXPOSE=true` and
`OTP_SHOW_IN_PRODUCTION=true`. Then a merchant and an admin signed in. The
API's own log contained:

```
{"merchantUserId":"a2cb…","channel":"otp","code":"914884","msg":"otp code generated (dev)"}
{"adminUserId":"0a08…","code":"223191","msg":"admin otp code generated (dev)"}
```

## Why it happened

Two switches can show the code on the sign-in page:

- `OTP_DEV_EXPOSE`, the development switch, also writes the code to the log
  so a developer can find it.
- `OTP_DEMO_DISPLAY`, added later for the hosted demo, only shows it on the
  page.

The deploy script used the development one.

## Fix

- **The deploy uses the demo display.** `ops/remote-deploy.sh` now writes
  `OTP_DEMO_DISPLAY=true` and `OTP_SHOW_IN_PRODUCTION=true`. It also removes
  any `OTP_DEV_EXPOSE` line left from an earlier deploy, so the next deploy
  of an existing server switches over by itself.
- **Defence in depth.** Both notifiers (`auth/notifier.ts` and
  `adminAuth/notifier.ts`) never put the code in a log line when
  `NODE_ENV=production`, whatever the switches say. Development still logs
  it when `OTP_DEV_EXPOSE=true`.
- **Docs.** `docs/deploy.md` names the switches the deploy uses and says the
  code stays out of the logs.

## Test

`apps/api/src/auth/notifier.test.ts`: "in production the code never reaches
the log, even with the demo switches on", for the merchant and admin
notifiers. Before the fix both logged the code.
