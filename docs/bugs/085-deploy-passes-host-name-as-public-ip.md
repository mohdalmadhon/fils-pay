# 085: Deploying to a host name sends the name as the server's IP

**Severity:** Low. A deploy to `user@pay.example.com` or to an ssh alias
built broken sslip.io addresses (and a broken certificate request) unless
SITE_HOST was set.

## Where

`ops/deploy.sh`, the `HOST` variable and the final `ssh -t` line.

## Why it was wrong

```bash
HOST="${SERVER#*@}"
...
ssh -t "$SERVER" "PUBLIC_IP='$HOST' ..."
```

Whatever came after `@` was passed as `PUBLIC_IP`, even when it was a DNS
name, or the whole argument for an ssh alias such as `myserver`.
`ops/remote-deploy.sh` then built the default site name from it:
`${ip//./-}.sslip.io`, giving names like `pay-example-com.sslip.io`, which
do not resolve to the server.

## How to reproduce

`ops/deploy.sh deploy@pay.example.test`: the remote command starts
`PUBLIC_IP='pay.example.test'`.

## Fix

`deploy.sh` passes `PUBLIC_IP` only when `HOST` is a dotted IPv4 address.
Otherwise it passes an empty value, and `remote-deploy.sh` falls back to
asking the network for its public IP, as it already did when `PUBLIC_IP`
was unset.

## Test

`scripts/deployScript.test.ts`: "PUBLIC_IP is passed only when the server is
given as an IPv4 address". It runs `ops/deploy.sh` with a fake `ssh`. Before
the fix `deploy@pay.example.test` gave `PUBLIC_IP='pay.example.test'`
instead of an empty value.
