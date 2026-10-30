# Deploying to the hosted box

The hosted box is `dilmune@159.89.173.8` (Dilmun Cloud, 1 vCPU). One
command from your machine deploys the commit you have checked out.

## What runs there

```
internet ──▶ Caddy (web)  :80 / :443, HTTPS certificates from Let's Encrypt
              ├─ 159-89-173-8.sslip.io       dashboard /dashboard, checkout /pay/<token>, /v1 → api
              └─ ops.159-89-173-8.sslip.io   Ops console, /v1 → api
             api           127.0.0.1:3000 (only Caddy and the box reach it)
             settlement, reporting
             postgres      127.0.0.1:5432, data in a Docker volume
```

`sslip.io` names resolve to the IP in them (`159-89-173-8.sslip.io` →
159.89.173.8), so HTTPS works without buying a domain. With a domain, point
it at the IP and deploy with `SITE_HOST=pay.example.com OPS_HOST=ops.example.com`.

**What works there, and what doesn't.** Checkout, payment links and the
API (with a merchant API key) work. **Signing in to the dashboard and the
Ops console does not**: the one-time sign-in code has no delivery channel
(no email sending exists), and showing it in the response or the logs is
switched off in production on purpose (`docs/cyper/03-insecure-defaults.md`).
Adding email delivery (SMTP) is the fix when sign-in is needed.

Every service has `restart: unless-stopped` and the api has a watchdog, so
a crash or a frozen api is restarted (`docs/perf/checkout-capacity.md`).

## Deploy

On your machine, in Git Bash, from the repo, on the branch to deploy:

```sh
SEED=1 ops/deploy.sh     # the first time: also loads the demo merchants
ops/deploy.sh            # every time after
```

It sends the committed code (uncommitted changes are not sent; it warns),
keeps the previous copy as `~/fils-pay.old`, then on the server
(`ops/remote-deploy.sh`):

1. installs Docker if it isn't there (asks for your sudo password);
2. creates the settings once, in `~/fils-pay-config` (owner-only): database
   passwords, the webhook encryption key, the settlement token, the acquirer
   signing secret, the public addresses. It never replaces one that
   exists. If an older deployment's `ops/.env` is found, its database
   password and keys are kept, since the database volume was created with
   them;
3. checks ports 80 and 443 are free (and opens them in `ufw` if it's on);
4. builds and starts everything, waits until the api is healthy, loads the
   demo data if `SEED=1` (only into an empty database), and prints the
   addresses.

The first build takes several minutes on one vCPU.

**Ports 80 and 443 must be open** in Dilmun Cloud's firewall: the
certificate is issued over them. If they can't be opened, deploy with
`HTTP_ONLY=1` (plain HTTP, cookies not marked Secure).

## Check it

```sh
curl https://159-89-173-8.sslip.io/healthz            # {"status":"ok", ... "load": {...}}
```

Then create a payment link with a merchant API key and pay it in the
browser with the test card `4242 4242 4242 4242`:

```sh
curl -X POST https://159-89-173-8.sslip.io/v1/merchants/<merchant id>/payment-links \
  -H "authorization: Bearer <API key>" -H "content-type: application/json" \
  -d '{"amountFils": 12345, "description": "Test", "expiresAt": "2026-12-31T00:00:00Z"}'
# open the "url" it returns
```

With `SEED=1` the demo data's API key for each merchant is printed during
the deploy (`seed: issued API key for Alpha Retail Co: ...`); copy it then,
it is not shown again. Alpha Retail's merchant id is
`9972daab-2c86-459f-9d78-3fe1be4e3280`. The capacity script uses the same
key (`API_KEY=... MERCHANT_ID=... node scripts/load/checkout-load.mjs`).

On the server:

```sh
cd ~/fils-pay
docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml ps
docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml logs -f api web
```

The capacity test and the database checks can be run against it as
described in `docs/perf/checkout-capacity.md`.

## Roll back

```sh
ssh dilmune@159.89.173.8
cd ~/fils-pay.old && cp ~/fils-pay-config/.env ~/fils-pay-config/.env.docker ops/
docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml up -d --build
```

Rolling back the code does not undo migrations; the older version then
runs on the newer schema. The migrations added recently only add tables,
columns and indexes, but check before rolling back across a migration that
changes or removes something.

## After the first deploy

- **Demo data (`SEED=1`) has known passwords** (`FilsPaySeed!2026` for the
  seeded merchant users, `FilsPayAdminSeed!2026` for the seeded admins). With
  sign-in codes undelivered they can't be used to sign in, but change them,
  or don't seed, before sign-in is enabled (`docs/cyper/17-open-findings.md`).
- The acquirer signing secret is generated on the server; give it to the
  acquirer simulator / partner if callbacks are used
  (`grep ACQUIRER ~/fils-pay-config/.env.docker`).
- Back up the database volume before anything risky:
  `docker compose -f ops/docker-compose.yml exec postgres pg_dump -U filspay filspay > backup.sql`.

## How this was checked

The workspace that prepared this couldn't reach the server (SSH) or
Docker Hub, so the containers themselves were not started there. What was
run:

- the Caddyfile with Caddy 2.8.4 (`adapt` and `validate`), in HTTPS and
  plain-HTTP modes;
- both apps built with the production settings, served by that Caddyfile
  in front of the api, and the browser end-to-end check run entirely
  through it on one origin: 11 of 11; the Ops console signed in on its own
  host;
- `docker compose config` with the overlay and with settings generated by
  `remote-deploy.sh`;
- `remote-deploy.sh` and `deploy.sh` in a sandbox with stand-in `docker`
  and `ssh`: a fresh server, a second run (settings unchanged), an older
  deployment (passwords kept, development switches removed), plain HTTP,
  and a redeploy keeping the previous copy.

The first real run on the box is the remaining check: its output says
whether Docker, the ports and the certificate are in order.
