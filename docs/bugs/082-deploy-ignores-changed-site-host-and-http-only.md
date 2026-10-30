# 082: A redeploy ignores new SITE_HOST, OPS_HOST and HTTP_ONLY settings

**Severity:** Medium. After the first deploy, changing the site's address or
switching between HTTP and HTTPS silently did nothing.

## Where

`ops/remote-deploy.sh`, step 2 (Settings), the `ensure` calls for
`SITE_ADDRESS`, `OPS_ADDRESS`, `COOKIE_SECURE`, `PUBLIC_SITE_URL` and
`PUBLIC_OPS_URL`.

## Why it was wrong

All settings were written with `ensure`, which only adds a key that is not
in the file yet:

```bash
ensure() {
  local file="$1" key="$2" value="$3"
  grep -q "^$key=" "$file" || printf '%s=%s\n' "$key" "$value" >> "$file"
}
...
ensure "$CONF/.env" SITE_ADDRESS "$site_host"
ensure "$CONF/.env" COOKIE_SECURE true
```

That is right for secrets (a new database password would lock the database),
but the addresses are not secrets. `~/fils-pay-config` is kept between
deploys, so after the first one these keys were always present and the new
values were thrown away. For example `HTTP_ONLY=1 ops/deploy.sh` after an
HTTPS deploy kept `COOKIE_SECURE=true` and the HTTPS addresses.

## How to reproduce

Deploy once (HTTPS on sslip.io), then run
`HTTP_ONLY=1 SITE_HOST=pay.example.test ops/deploy.sh`. `~/fils-pay-config/.env`
still has `SITE_ADDRESS=<ip>.sslip.io` and `COOKIE_SECURE=true`.

## Fix

A new `set_key` helper deletes any existing line for the key and writes the
new value. The five address settings use it, so they are rewritten on every
deploy. Secrets still use `ensure` and are never replaced.

## Test

`scripts/remoteDeploySettings.test.ts`: "a redeploy updates the addresses and
keeps the secrets". It runs the real script twice with a fake `docker` and
`curl` and a temporary home folder. Before the fix the second run left
`SITE_ADDRESS` as `'203-0-113-7.sslip.io'` instead of
`'http://pay.example.test'`.
