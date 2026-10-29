# Runbook

Short on purpose. If something here is wrong or missing, fix it after the
incident, not during.

## Health

- `GET /healthz` — the process answers. That's all it tells you.
- `GET /readyz` — the API reached Postgres when it booted. It does not
  re-check afterwards; a green `/readyz` says nothing about the database
  right now. To check the database, run a query.

> **FH:** the FP-215 PR description says readyz re-checks every 30s now. not sure it merged
>
> **— unsigned:** it pings on every request since FP-215. this section is stale

## The API container keeps restarting / requests die with no error

No stack trace in the app logs usually means the kernel killed it, not
Node. The API container is capped at 512 MB.

```bash
dmesg -T | grep -i -E "killed process|out of memory"
docker inspect <container> --format '{{.State.OOMKilled}}'
```

If it's OOM, find the request that was in flight when it died (the access
log line that never got a response) before raising the limit.

The most common cause so far has been sharp's in-process image cache when
support pages through KYC thumbnails. Set `SHARP_CACHE=0` on the API
container and restart.

## Settlement didn't run for a day

The daemon only catches up the most recent business day on restart. For
anything older:

```bash
settlement run-batch --date=YYYY-MM-DD            # every merchant
settlement run-batch --date=YYYY-MM-DD --merchant=<uuid>
```

`--date` is the Bahrain business date. Safe to repeat: a batch that's
already closed or paid is left alone.

> **— unsigned:** re-running a date from before a merchant went live can settle their test captures. check go-live dates first

## A merchant's balance looks wrong

`merchant_balances` is a cache. Recompute it:

```bash
settlement rebuild-balances                       # prints before/after per merchant
settlement rebuild-balances --merchant=<uuid>
```

The full CLI rebuild and the console's **Rebuild cached balances** now use
the same payable-ledger calculation for all merchants. The `--merchant`
option currently calculates and prints that merchant's ledger balance; it
does not update the cache.

Rebuilds overwrite cache-only display adjustments. Investigate any remaining
difference against the ledger and statement history before applying another
display adjustment. The button can take as long as the full ledger rebuild;
the existing HTTP timeout and concurrent-write limitations are unchanged.
See [the problem 4 investigation](solved-problems/003-admin-balance-rebuild-source.md)
and [ADR 0007](adr/0007-ledger-backed-admin-balance-rebuild.md).

## Dashboards look stale

Analytics lag the write model by up to a poll interval; every response
carries `readModelAsOf`. If it's stuck:

```bash
npx tsx apps/reporting/src/index.ts catch-up
```

`catch-up` shares the worker's cursor, so it's safe to run while the worker
is up. Then check the reporting worker is running and connected.

If `readModelAsOf` is `null` after a fresh seed, restart the worker; it
usually needs a couple of restarts while Postgres warms up.

> **MK:** stop the worker before catch-up. two consumers on one cursor double-apply.

## Webhooks aren't arriving

1. Look at the endpoint's delivery log (dashboard, or
   `GET .../webhook-endpoints/:id/deliveries`). `failed` means we got a non-2xx
   and will retry; `exhausted` means retries are done.
2. Check the merchant's endpoint URL and that their receiver returns 2xx
   within the timeout.
3. If **no** merchant is receiving anything, restart the API — the
   dispatcher's `LISTEN` connection occasionally drops (FP-236).
4. Replay from the dashboard, or in bulk from the admin console.

> **FH:** last stall had a TypeError from buildEnvelope in the logs and came back after restart on the same event
>
> **— M?** bad deploy, rolled back

If a merchant reports that signatures don't verify, ask them to parse the
body and re-serialise it with sorted keys before computing the HMAC; some
HTTP frameworks reorder JSON keys.

> **MK:** if signatures don't verify over the raw body, that's on us. FP-240

## Scheme file for a batch

```bash
settlement export-scheme-file --batch=<uuid> --out=/tmp/batch.csv
```

Re-exporting gives an identical file; it's written from rows frozen at
close. The `amount` column is in the scheme's two-decimal format and is
what the scheme was paid; finance reconciles against it.

## Split payouts

For a split parent, the children's configured weights must be positive and
total exactly 10,000 basis points (100%). Invalid configuration causes the
payout to fail without posting money or marking the closed batch paid.
Correct the configuration before retrying the closed batch.

Whole-fils allocations use largest remainders: floor each proportional
share, then distribute the remaining fils in descending fractional-remainder
order. Equal remainders favor ascending child merchant UUID. The children,
payout ledger legs, and parent cache deduction must agree with the frozen
batch net payout. Zero-share children get split audit rows without zero-value
ledger entries.

Already-paid batches are skipped; retrying does not repair old allocations.
For historical discrepancies, inspect `settlement_batch_splits` and the
parent's payable ledger before proposing a correction. Three independently
rounded shares totaling 100% could previously differ by at most one fil per
batch; larger differences require further investigation.

See [the split payout fix record](solved-problems/002-split-payout-allocation.md)
for affected code, verification, and a read-only audit query.

## Month-end residue (finance)

Until residue posting is automated (see ARCHITECTURE, "The scheme
boundary"), finance runs a month-end script modelled on
`scripts/reconcile_march.ts`:

1. Copy the script, change the window constants at the top to the new
   month (UTC calendar month, `YYYY-MM-01T00:00Z` to the first of the next
   month).
2. Run it once against production with finance on the call.
3. Attach the log from `scripts/out/` to the month-end ticket.

The script checks for an existing posting with the same description, so a
second run is a no-op.

> **Huda** (#fp-finance): please don't run anything for April onwards until March (FP-187) is resolved

## Resetting a non-production environment

```bash
npm run migrate && npm run seed
```

The seed truncates and regenerates the fixture tables it owns and
self-checks the result. It prints `REAL FAIL` lines if anything doesn't
come out as expected — don't ignore them. It won't touch other tables, so
it's safe against a shared staging database.

> **AM (Sept):** check DATABASE_URL before seeding. staging-2 got reset this way
