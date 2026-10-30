# 088: The deployment check in ops/README.md signs in with a replaced password

**Severity:** Low. Following "Checking a deployment end to end" against the
hosted box failed at the first step (sign-in), which looks like a broken
deploy when it is not.

## Where

`ops/README.md`, section "Checking a deployment end to end", and
`scripts/e2e/payment-check.mjs`, which defaults the password.

## Why it was wrong

The README gave only:

```
API_URL=https://<api host> WEBHOOK_URL=<public receiver> node scripts/e2e/payment-check.mjs
```

The script signs in as the seeded Alpha Retail owner with

```js
const PASSWORD = process.env.MERCHANT_PASSWORD ?? "FilsPaySeed!2026";
```

the public seed password. But on the hosted box `ops/remote-deploy.sh` runs
`db/seed/replaceDemoPasswords.ts` on every deploy (unless `SHOW_OTP=0`),
which replaces that password with a random one and saves it in
`~/fils-pay-config/demo-passwords.txt`. So the README's command always got
401 at sign-in there.

## How to reproduce

Deploy with `SEED=1`, then run the README command against the site. The
"merchant sign-in" check fails.

## Fix

The README now explains when the default works (locally) and gives a
command for the hosted box that reads the current merchant password from
`~/fils-pay-config/demo-passwords.txt` over ssh and passes it as
`MERCHANT_PASSWORD`. The script is unchanged.

## Test

Documentation only. The `grep ... | tail -1 | sed` part was checked against
a file in the format `replaceDemoPasswords.ts` prints
(`demo passwords: new password for 4 merchant users: <password>`, followed by
the admins line and later "no merchant users use the public demo password"
lines) and returns the merchant password.
