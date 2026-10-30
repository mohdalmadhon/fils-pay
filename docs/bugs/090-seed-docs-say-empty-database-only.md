# 090: The deploy docs say SEED=1 only loads into an empty database

**Severity:** Low. Someone redeploying with `SEED=1` to "top up" the demo
would lose all demo activity, API keys and admin users without being asked.

## Where

`docs/deploy.md` (what the deploy does, step 4) and the header and step 4
message of `ops/remote-deploy.sh`. The behaviour is in `db/seed/guard.ts`,
`assertSeedMayReset`.

## Why it was wrong

Both places said the demo data is loaded "only into an empty database":

```bash
#   SEED=1      load the demo data, only into an empty database
```

The guard only counts merchants whose name is not a demo merchant's name:

```ts
(SELECT count(*) FROM merchants WHERE display_name <> ALL($1::text[]))::text AS foreign
...
if (Number(row.foreign) > 0 && env.SEED_RESET_CONFIRM !== row.db) {
```

So a database that holds only the demo merchants passes, and the seed then
runs `TRUNCATE ... CASCADE` over merchants, transactions, the ledger,
settlement batches, admin users and more. Everything done on the demo since
the last seed is wiped, with no `SEED_RESET_CONFIRM` needed.

## How to reproduce

Deploy with `SEED=1`, make a payment on Alpha Retail in the dashboard, then
deploy again with `SEED=1`. The payment is gone and the old API keys no
longer work.

## Fix

Documentation only. `docs/deploy.md` now says when the seed refuses, that a
demo-only database is re-seeded without asking, and what a re-seed wipes.
The `remote-deploy.sh` header and its "Loading demo data" message say the
same. The guard is unchanged: refusing a demo-only database with activity
would need a rule for what counts as "activity" and would change the
documented reset flow, which is a product decision.

## Test

Documentation only. The guard's behaviour is covered by
`db/seed/guard.test.ts` ("refuses a database holding merchants the seed
didn't create, unless confirmed by name").
