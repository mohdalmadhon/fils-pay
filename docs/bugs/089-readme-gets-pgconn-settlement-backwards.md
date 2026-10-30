# 089: ops/README.md describes PGCONN_SETTLEMENT the wrong way round

**Severity:** Low. Someone pointing the settlement worker at another
database would expect `DATABASE_URL` to win and get the opposite, or unset
`DATABASE_URL` and have the worker refuse to start.

## Where

`ops/README.md` (the paragraph about `PGCONN_SETTLEMENT`) and a comment in
`ops/docker-compose.yml` (settlement service). The behaviour is in
`apps/settlement/internal/config/config.go`, `Load`.

## Why it was wrong

The README said:

> `PGCONN_SETTLEMENT`, for its batch-close pool. It only takes effect when
> `DATABASE_URL` is unset.

The code does the opposite, and `DATABASE_URL` cannot be unset:

```go
databaseURL := os.Getenv("DATABASE_URL")
if databaseURL == "" {
    return Config{}, fmt.Errorf("config: DATABASE_URL environment variable is not set")
}
...
if override := os.Getenv("PGCONN_SETTLEMENT"); override != "" {
    databaseURL = override
}
```

So `PGCONN_SETTLEMENT` overrides `DATABASE_URL` whenever it is set, and it
is used for the worker's only pool, not a separate batch-close pool. The
compose comment ("PGCONN_SETTLEMENT is ignored while DATABASE_URL is set")
said the same wrong thing.

## How to reproduce

Start the worker with `DATABASE_URL=postgres://a/db` and
`PGCONN_SETTLEMENT=postgres://b/other`: it connects to `b`. Start it with
only `PGCONN_SETTLEMENT`: it exits with "DATABASE_URL environment variable
is not set".

## Fix

The README and the compose comment now say what the code does: a non-empty
`PGCONN_SETTLEMENT` replaces `DATABASE_URL` for the whole worker, and
`DATABASE_URL` is still required. The code is unchanged.

## Test

Documentation only. The behaviour is already covered by
`apps/settlement/internal/config/config_test.go`:
`TestLoad_PgconnSettlementOverridesWhenSet` and
`TestLoad_DatabaseURLRequired` (both pass).
