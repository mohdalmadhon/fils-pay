# 13: Every service connected as the database owner

| | |
|---|---|
| **Type** | Security hardening ([`docs/cyper/17`](../cyper/17-open-findings.md), finding 6) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `ops/docker-compose.yml`: api, settlement, reporting, migrate and seed all used `postgres://filspay:…`, the role that owns the database. A TODO said "give the api its own role before anything is hosted"; the box was hosted. |

## What was wrong

A SQL injection, a leaked `DATABASE_URL`, or a bug in **any** service meant
full control of every table: DDL, `TRUNCATE`, editing ledger history (only a
trigger stood in the way), reading password hashes and API key hashes. The
reporting worker, which only reads the outbox and writes rollups, had the
same power as the migration runner.

## Fix

`ops/db/service-roles.sql` (idempotent; passwords as psql variables) creates:

| Role | Can | Can't |
|---|---|---|
| `filspay_api` | read/write all tables; `TRUNCATE` the two reporting rollups (admin rebuild) | DDL; `TRUNCATE` anything else; `UPDATE`/`DELETE` on `ledger_entries`; write `schema_migrations` |
| `filspay_settlement` | read everything; insert ledger entries, outbox events, scheme lines, splits; write batches, balances, platform volume, capture-event claims, merchants (lifetime estimate) | touch users, sessions, API keys, webhooks; change or delete ledger history |
| `filspay_reporting` | read `outbox_events`, `transactions`, `transaction_events`, `settlement_batches`; write its rollups and cursor | read users, keys, sessions or the ledger; write anything else |

The grants were derived from every `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`
and `FOR UPDATE`/`FOR SHARE` in each service's non-test code. Row locks need
`UPDATE` privilege.

| # | Commit |
|---|---|
| 1 | `test: each database role can do its job and nothing more` (scratch database, migrate, apply, connect as each role) |
| 2 | `ops: a least-privilege database role per service` |
| 3 | `ops: compose runs each service as its own database role` (a `db-roles` job after migrate, on every `up`) |
| 4 | `docs(ops): document the per-service database roles` |
| 5 | `docs: improvement 13, database roles` |

## Verified

- **The real flow, as the restricted roles:** on a new database (migrate,
  seed, script), the API ran as `filspay_api`, `settlement run-batch` as
  `filspay_settlement` and `reporting catch-up` as `filspay_reporting`.
  `scripts/e2e/payment-check.mjs`: **20 passed, 0 failed**, with no
  "permission denied" in the API log.
- `scripts/serviceRoles.integration.test.ts`: the denials hold (no DROP,
  TRUNCATE, or ledger UPDATE/DELETE for any service; settlement can't touch
  users or keys; reporting can't read them). It fails without the script and
  skips where `psql` isn't installed.
- `docker compose config` renders with the role URLs and the `db-roles`
  dependency.

## After merging

- Add `API_DB_PASSWORD`, `SETTLEMENT_DB_PASSWORD` and `REPORTING_DB_PASSWORD`
  to `ops/.env` (`ops/README.md` shows how).
- A future migration that adds a table settlement or reporting must use needs
  a grant added to the script. The api gets default privileges on new tables
  automatically.
