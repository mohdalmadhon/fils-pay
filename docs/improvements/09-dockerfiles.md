# 09: The Dockerfiles compose builds from were missing

| | |
|---|---|
| **Type** | Deployment blocker |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `ops/docker-compose.yml`: every service builds from `ops/Dockerfile.node` or `ops/Dockerfile.go`, and neither file was in the repo. A compose comment said "if they're missing for you, pull main again". They were never committed on any branch. This is also why "is it live on Dilmun Cloud?" couldn't be answered in the end-to-end check. |

## What was wrong

`docker compose up` failed at the build step for every service. Nothing in
the repo could produce an image, so the stack couldn't be deployed from it.
KYC uploads were also written inside the api container with no volume, so
they would have been lost on every rebuild.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `ops: add a .dockerignore that keeps secrets and build output out of images` | Excludes `.git`, `node_modules`, `dist`, local `data/`, and every `.env*` except `*.example`. |
| 2 | `ops: add Dockerfile.node for migrate, seed, api and reporting` | `node:22-bookworm-slim`, `npm ci` with dev dependencies (the services run TypeScript through `tsx`), non-root `node` user, writable KYC directory. |
| 3 | `ops: add Dockerfile.go for the settlement daemon` | Multi-stage: `golang:${GO_VERSION}` builds a static binary; runtime is `distroless/static`, non-root. `GO_VERSION` defaults to 1.24 (1.25 for the pgx upgrade). |
| 4 | `ops: compose keeps KYC uploads in a volume; README explains the images` | `filspay_kyc` volume; `ops/README.md`, "Building the images". |
| 5 | `docs: improvement 09, Dockerfiles` | This file. |

## How it was verified

Docker Hub is blocked from the build machine, so `docker build` itself
couldn't run (no base images). Instead each Dockerfile's steps were run by
hand:

- **Node:** in an empty directory, copy only the package files, `npm ci
  --include=dev` (183 packages), copy the rest with the `.dockerignore`
  exclusions (the copy had no `.env.docker`), then on a new database:
  `npm run migrate` (75 applied), `npm run seed` (assertions pass), the API
  boots and answers `401` on `/v1/auth/me`, and `reporting catch-up` processes
  the seeded events.
- **Go:** the same `CGO_ENABLED=0 go build -trimpath` produces a static
  executable (`ldd`: "not a dynamic executable"). The daemon starts, listens on
  8091 and runs the daily batch.
- `docker compose config` renders with the new volume.

**First thing to do on a machine with Docker:**
`docker compose -f ops/docker-compose.yml build`. Report anything that fails.
