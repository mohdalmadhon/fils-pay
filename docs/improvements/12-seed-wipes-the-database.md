# 12: `docker compose up` emptied the database every time

| | |
|---|---|
| **Type** | Data-loss bug (found while looking at "seeded passwords on a hosted box", [`docs/cyper/17`](../cyper/17-open-findings.md) finding 5) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `db/seed/generate.ts:100-140` (the truncate list) and `ops/docker-compose.yml` (`seed` service, no profile); the false claims in `ops/docker-compose.yml` ("the seed only truncates its own fixture tables, so pointing this at a shared database is fine. MK: correct."), `docs/RUNBOOK.md` ("It won't touch other tables, so it's safe against a shared staging database") and `ops/README.md` |

## What was wrong

The seed's first step is one `TRUNCATE ... CASCADE` over `merchants`,
`merchant_users`, `transactions`, `ledger_entries`, `settlement_batches`,
`scheme_export_lines`, `outbox_events`, `holds`, `admin_users`,
`platform_stats` and more. CASCADE takes everything that references them. In
effect, **it empties the database**.

Three things made that dangerous:

1. **Compose ran it on every `docker compose up`.** The `seed` service had no
   profile, so starting the stack ran it, on the hosted demo box too: every
   deploy or restart wiped all data.
2. **The docs said it was safe**, on a shared database or staging.
3. **It had already happened.** A note in the runbook: *"check DATABASE_URL
   before seeding. staging-2 got reset this way"*.

The seed also creates `superadmin@filspay.test` with a password that is in the
repo, which made a seeded hosted box a takeover target
([`docs/cyper/03`](../cyper/03-insecure-defaults.md)).

## Fix

| # | Commit |
|---|---|
| 1 | `test: the seed refuses to wipe production or a database with real data` |
| 2 | `seed: refuse to run in production or over data the seed didn't create`: `db/seed/guard.ts`, called before the truncate |
| 3 | `ops: compose no longer seeds (and wipes) the database on every up`: `profiles: ["seed"]` |
| 4 | `docs: the seed empties the database; run its guard and the migration check in CI`: RUNBOOK, ops/README, `npm run test:db`, CI |
| 5 | `docs: improvement 12, the seed wipes the database` |

The guard refuses:

- **`NODE_ENV=production`**, with no override;
- **any database holding a merchant the seed didn't create**, unless
  `SEED_RESET_CONFIRM` is set to that database's name.

A new or previously seeded database seeds without a flag.

To seed in compose now (local only):

```bash
docker compose -f ops/docker-compose.yml --profile seed run --rm seed
```

## Verified

- `db/seed/guard.test.ts` (2) passes. `npm run seed` refused a database that
  held test merchants, with the instructions above, and re-seeded a seed-only
  database as before.
- `docker compose config --services` no longer lists `seed`; with
  `--profile seed` it does.
- `npm run test:db` (this guard plus `migrate.integration.test.ts`): 3/3 with a
  TCP `DATABASE_URL`. The migration test can't parse a socket-style URL
  (`postgres://user@/db?host=/path`); CI uses TCP.

## After deploying

- On the hosted box, check whether the database has been reset by past
  deploys. Compare `merchants.created_at` with the deploy history.
- Don't run the seed there. Change the seeded admin's password if it ever
  ran (`docs/cyper/03`).
