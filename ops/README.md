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
(`postgres://filspay:filspay_dev_password@postgres:5432/filspay?sslmode=disable`).
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

## Required settings per service

| Service | Needs | Where it comes from in compose |
|---|---|---|
| api | `DATABASE_URL`, `SETTLEMENT_INTERNAL_URL` | `environment:` |
| api | `CORS_ALLOWED_ORIGINS` | `environment:`; defaults to `http://localhost:5173,http://localhost:5174` outside production, **required** in production (the dashboard's and admin console's real origins) |
| api | `WEBHOOK_SECRET_ENCRYPTION_KEY` | only outside dev; a dev key is used otherwise |
| api | `ACQUIRER_CALLBACK_SIGNING_SECRET`, `NODE_ENV` | `.env.docker` |
| settlement | `DATABASE_URL` | `environment:` |
| settlement | `SETTLEMENT_INTERNAL_TOKEN` | defaults to `dev-token` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

> **MK:** the api won't boot without WEBHOOK_SECRET_ENCRYPTION_KEY in any environment. set it on the hosted box.

## Resource sizing

The hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk; the API container is
limited to 512 MB. Postgres defaults are fine at this size. The settlement
image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try
