# ops/

Local development stack for FilsPay: Postgres plus the three services that
talk to it directly (apps/api, apps/settlement, apps/reporting). The hosted
demo instance uses the same compose file with a different `.env`.

## Quick start

```
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml --profile seed run --rm seed   # local only: empties the database
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
| `.env.docker` | api settings, loaded with `env_file:` (create it from `.env.docker.example`) |
| `Dockerfile.node` | image for api, reporting, migrate and seed (Node 22, dev dependencies for tsx) |
| `Dockerfile.go` | multi-stage build of `apps/settlement` |

The two Dockerfiles were missing from the repo until 2026-10-30
(`docs/improvements/09`); they had never been committed.

## Database

Each service connects as its own least-privilege role
(`ops/db/service-roles.sql`, docs/improvements/13):

| Role | Used by | Can |
|---|---|---|
| `filspay` (owner) | migrate, seed, `db-roles` | everything |
| `filspay_api` | api | read/write all tables; no DDL; `TRUNCATE` only on the two reporting rollups; `ledger_entries` insert-only |
| `filspay_settlement` | settlement | read everything; write only batches, ledger inserts, scheme lines, splits, balances, platform volume, capture-event claims |
| `filspay_reporting` | reporting | read the outbox and the few tables it uses; write only its rollups and cursor |

The `db-roles` job applies the script after every `migrate`, so tables added
by new migrations get the api's default privileges. A new table that
settlement or reporting must use needs a grant added to the script.
`sslmode=disable` is safe here: the services and Postgres share the compose
network and Postgres is only published on `127.0.0.1`.

Outside compose, run the script yourself as the owner:

```bash
psql "$OWNER_DATABASE_URL" -v api_password=... -v settlement_password=... \
  -v reporting_password=... -f ops/db/service-roles.sql
```

The settlement worker can be given a second connection string,
`PGCONN_SETTLEMENT`, for its batch-close pool. It only takes effect when
`DATABASE_URL` is unset.

To reset a **local** database to the demo data, run the `seed` job above.
It empties the whole database first (it does not only touch its own tables),
refuses `NODE_ENV=production`, and refuses a database with merchants it
didn't create unless `SEED_RESET_CONFIRM=<database name>` is set
(`docs/improvements/12`).

## Building the images

Compose builds two images from the repo root:

| Image | Used by | Notes |
|---|---|---|
| `ops/Dockerfile.node` | migrate, seed, api, reporting | Node 22; compiled API/reporting, tsx migration/seed; non-root `node` user; KYC uploads in the `filspay_kyc` volume |
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
| api | `OTP_LOG_FILE` | optional private server file for temporary operator OTP delivery; see `docs/fixes/operator-otp-file.md` |
| api | `OTP_DEMO_DISPLAY` | default false; explicit demo-only OTP display on both login screens, including a production-mode demo; does not enable development logging |
| settlement | `DATABASE_URL` | `environment:` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

Before the first `up`, create the two env files. Both are gitignored.

```bash
cp ops/.env.docker.example ops/.env.docker   # then set the acquirer secret
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> ops/.env
echo "API_DB_PASSWORD=$(openssl rand -hex 24)" >> ops/.env
echo "SETTLEMENT_DB_PASSWORD=$(openssl rand -hex 24)" >> ops/.env
echo "REPORTING_DB_PASSWORD=$(openssl rand -hex 24)" >> ops/.env
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

The hosting target is **1 vCPU / 2 GB for the whole stack**, with the API
limited to **0.5 vCPU / 512 MiB**. Compose enforces those API limits and
uses a 320-MiB V8 heap, leaving room for native allocations and buffers.
Reporting's limit is 384 MiB and settlement's 256 MiB; PostgreSQL and the OS
share the remaining host resources (`max_connections=120`). The limits are
ceilings, not reserved RAM or proof that every workload fits the host.

`npm run build:node` compiles the existing TypeScript API/reporting sources;
Docker builds and runs `build/node/api.mjs` and `build/node/reporting.mjs`.
Migration and seed jobs retain their existing tsx commands. All monetary
source stays unchanged. For a source-only local checkout, tsx still works.

The ~38-checkouts/s measurements in `docs/perf/checkout-capacity.md` and
`docs/perf/2026-10-30-capacity-follow-up.md` used one shared logical CPU,
without enforcing the API's half-CPU/512-MiB container limit. They are not a
capacity certification for this hosting budget. See
`docs/perf/2026-10-30-remaining-capacity-fixes.md` for the latest comparisons,
compatibility checks, migration 0084 and test limitations.

Every long-running service has `restart: unless-stopped`; the api also has a
watchdog that kills it if its event loop freezes, so it is restarted too.
`docker ps` shows restarts; `GET /healthz` shows the api's `load` (requests
in flight, requests turned away since start).

The settlement image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try
