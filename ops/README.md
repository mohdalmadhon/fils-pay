# ops/

Local development stack for FilsPay: Postgres plus the three services that
talk to it directly (apps/api, apps/settlement, apps/reporting). The hosted
demo instance uses the same compose file with a different `.env`.

## Quick start

```
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml run --rm seed
docker compose -f ops/docker-compose.yml up api settlement reporting
```

apps/web and apps/admin aren't part of this compose file — they're plain
Vite dev servers that talk to apps/api over HTTP (`npm run dev` inside
each package), not services with their own database connection.

## Checking a deployment end to end

After deploying (or after `migrate` + `seed` locally), run the payment check
against the API. It creates a link, pays it, follows the money through the
ledger, settlement and payout, verifies the webhooks, and checks
reconciliation is zero:

```
API_URL=https://<api host> WEBHOOK_URL=<public receiver> node scripts/e2e/payment-check.mjs
```

Use staging, not production; it creates real rows. The full options, and
what a passing run looks like, are in
`docs/verification/end-to-end-2026-10-30.md`.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | the stack |
| `.env.docker` | shared service settings, loaded by compose for every service |
| `Dockerfile.node` | image for api, reporting, migrate and seed (`node:20`, full install) |
| `Dockerfile.go` | multi-stage build of `apps/settlement` |

> **AM (July):** the two Dockerfiles aren't in the repo for me. built my own
>
> **MK:** they were in the initial ops commit. check you're on main

## Database

Every service, plus the one-off `migrate`/`seed` jobs, connects with the
same `filspay` role and the same `DATABASE_URL`
(`postgres://filspay:${POSTGRES_PASSWORD}@postgres:5432/filspay?sslmode=disable`,
with the password from `ops/.env`).
One role keeps local setup to a single password instead of hand-rolling
per-service grants for a stack this size. `sslmode=disable` is safe here:
Postgres and every service run on the same Docker Compose bridge network,
which never carries traffic outside the host, so there's no untrusted hop
for a connection to cross.

The settlement worker can be given a second connection string,
`PGCONN_SETTLEMENT`, for its batch-close pool. It only takes effect when
`DATABASE_URL` is unset.

To reset the database to a clean, freshly-seeded state at any point, re-run
the `seed` job above — `db/seed/index.ts` truncates and regenerates its
fixture tables on every invocation; it doesn't need the volume removed
first.

## Building the images

Compose builds two images from the repo root:

| Image | Used by | Notes |
|---|---|---|
| `ops/Dockerfile.node` | migrate, seed, api, reporting | Node 22; runs TypeScript with tsx; non-root `node` user; KYC uploads in the `filspay_kyc` volume |
| `ops/Dockerfile.go` | settlement | static binary on distroless, non-root; `GO_VERSION` build arg (default 1.24) |

```bash
docker compose -f ops/docker-compose.yml build
docker compose -f ops/docker-compose.yml up
```

`.dockerignore` keeps `.git`, `node_modules` and every `.env*` file (except
`*.example`) out of the images; secrets reach the containers at run time.

## Required settings per service

| Service | Needs | Where it comes from in compose |
|---|---|---|
| api | `DATABASE_URL`, `SETTLEMENT_INTERNAL_URL` | `environment:` |
| api | `CORS_ALLOWED_ORIGINS` | `environment:`; defaults to `http://localhost:5173,http://localhost:5174` outside production, **required** in production (the dashboard's and admin console's real origins) |
| api | `WEBHOOK_SECRET_ENCRYPTION_KEY` | **required everywhere**; from your shell or `ops/.env` via `${...}`. There is no built-in key. |
| api, settlement | `SETTLEMENT_INTERNAL_TOKEN` | **required**, same value on both; from your shell or `ops/.env`. There is no `dev-token` fallback. |
| api | `ACQUIRER_CALLBACK_SIGNING_SECRET`, `NODE_ENV` | `.env.docker`, loaded with `env_file:` |
| api | `OTP_DEV_EXPOSE` | off unless set to `true`; refused when `NODE_ENV=production` |
| settlement | `DATABASE_URL` | `environment:` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

Before the first `up`, create the two env files. Both are gitignored.

```bash
cp ops/.env.docker.example ops/.env.docker   # then set the acquirer secret
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> ops/.env
echo "WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> ops/.env
echo "SETTLEMENT_INTERNAL_TOKEN=$(openssl rand -hex 32)" >> ops/.env
```

Compose reads `ops/.env` for the `${...}` values in the compose file; it
does not inject it into containers. `ops/.env.docker` is injected into the
api with `env_file:`.

Postgres is published on `127.0.0.1:5432` only, for local tools. Don't change
it to `5432:5432` on a hosted box: Docker's published ports bypass host
firewalls such as ufw.

## Resource sizing

The hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk; the API container is
limited to 512 MB. Postgres defaults are fine at this size. The settlement
image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try
