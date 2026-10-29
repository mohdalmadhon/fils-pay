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

## Daily close timing

The settlement daemon uses the Asia/Bahrain calendar to close the business
day that just ended. It becomes due at local midnight plus
`SETTLEMENT_DAEMON_RUN_DELAY_MINUTES`, which defaults to 15: **00:15 Bahrain
time**, or **21:15 UTC on the previous UTC date**. Set that variable to `0`
for a midnight due time if the grace period is not required. The daemon
checks immediately on startup and then every
`SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS` (60 seconds by default), so an
actual start can be up to one polling interval after it becomes due.

Rebuild and restart the settlement daemon to load the timing fix or changed
configuration. Changing `TZ` only changes log rendering; it is not the fix
for the previous UTC-date selection bug. Log-only "next check-in" estimates
are not the scheduling decision. Compare the `RunDailyBatch(YYYY-MM-DD)`
business date with the instant rendered in Bahrain time when investigating.

Restart catch-up still covers only the most recently completed business
day. Review older missed dates separately before using manual batch runs;
the timing fix does not backfill or reopen historical batches. See
[the cause, references, and verification](solved-problems/008-daily-close-bahrain-time.md).

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

If a merchant reports that signatures don't verify, check they compute
HMAC-SHA256 over `${t}.${rawBody}` using the body **exactly as received**
(before any JSON parsing), compare against `v1`, and use the endpoint's current
secret. Re-serializing the JSON on their side will break verification. We sign
the exact bytes we send (fixed 2026-10-29, see docs/fixes/webhook-signatures.md).

> **MK:** if signatures don't verify over the raw body, that's on us. FP-240

## Scheme file for a batch

```bash
settlement export-scheme-file --batch=<uuid> --out=/tmp/batch.csv
```

Re-exporting gives an identical file; it's written from rows frozen at
close. The `amount` column is in the scheme's two-decimal format and is
what the scheme was paid; finance reconciles against it.

## Payment-link cancellation ownership

Cancellation requires an authenticated owner/finance session or merchant
API key. The path merchant must match the authenticated merchant; the link
must also belong to that merchant. A foreign link returns the same
`404 payment_link_not_found` as a missing link, without changing its status.
An owned active link returns 204; an owned non-active link returns
`409 not_cancelable`.

Deploy/restart the API to activate the ownership fix. No migration is
required. For previously affected links, correlate request/session logs
with link ownership and cancellation timestamps. The link row does not
record who canceled it, so timestamps alone cannot establish unauthorized
access. See [the cause, references, and verification](solved-problems/011-payment-link-cancel-ownership.md).

## Test merchants and settlement

The daily settlement scan requires `status = 'active' AND test_mode = false`.
**Recompute transaction statuses** preserves test/live mode; it is not a
go-live action. Its `flagsUpdated` response/audit field remains present and
is empty. The previous implementation silently cleared the sandbox flag
after scanning transactions, making those merchants eligible for real runs.

For merchants previously affected, inspect `transaction_status_recompute`
audit records and verify their approved operating mode. Restore an
incorrectly cleared flag only after identifying the merchant and checking
for a legitimate later go-live. Review existing batches, payout ledger legs,
and exports separately; changing a flag does not reverse prior settlement.
See [the fix, evidence, and audit query](solved-problems/010-test-merchants-in-settlement.md).

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

## Lifetime payout monitoring estimate

`merchants.lifetime_net_payout_monitoring_estimate` is integer fils after
migration 0073. `PayoutBatch` adds the paid net transactionally; retries
skip paid batches. This counter covers ordinary payouts, not split payouts.
It is monitoring data and must not be used to decide how much to pay.

Migration 0073 changes the type and reconstructs existing totals from
ordinary payout ledger debit legs. Prepare DBA approval and a maintenance
window: stop payout workers and other writers, snapshot the old estimates,
confirm historical payout ledger coverage, apply the migration transaction,
then deploy/restart the settlement worker and reconnect database clients.
The migration locks batches, merchants, and ledger tables and can block
other requests. Never replay payouts to rebuild this counter. Casting the
old REAL totals alone cannot recover lost fils.

See [the detailed deployment plan, audit query, and reference trail](solved-problems/009-lifetime-payout-estimate.md).

## MDR recalculation

**Recalculate MDR** refreshes provisional totals only for existing open
batches in the selected merchant/date range. It skips closed and paid
batches, including closed batches that have not yet been paid. A range
containing only finalized batches returns zero considered batches.

No ledger adjustment or cached balance movement is posted by this action.
`CloseBatch` still computes the final fees and net using its settlement
rules when the batch closes. Historical fee corrections require a separate
approved adjustment; do not reopen a paid batch to force a recalculation.

For older discrepancies, compare the original payout instructions, stored
child allocations, ledger groups described as `MDR recalculation adjustment`,
and the `mdr_recalculation` admin audit events. Existing stored batch totals
may already have been rewritten by the previous implementation. Do not
assume a rerun will restore history.

See [the investigation and references](solved-problems/004-mdr-finalized-batches.md)
and [ADR 0008](adr/0008-mdr-finalized-batches.md).

## Month-end residue (finance)

`scripts/reconcile_march.ts` is a March-2026-only recovery tool, not a generic
monthly sweep or a Q1 reconciliation. Do not copy it to later months. The
earlier claim that it checked for an existing description was incorrect.

With the intended `DATABASE_URL` configured, preview without posting:

```bash
npx tsx scripts/reconcile_march.ts --dry-run
```

Omitting the flag also previews. Unknown flags and `--apply --dry-run` fail.
An apply requires the updated script and an explicit `--apply`. Review the
preview and the selected transactions/accounts with finance first. Apply
in maintenance: the script briefly blocks transaction and ledger writes,
with a 10-second lock-acquisition timeout. Retire old script copies first.

Matching new-format postings are skipped. Any legacy posting, duplicate,
changed source fingerprint, or malformed prior group blocks the entire
apply with a nonzero exit status. Resolve historical uncertainty through
ledger review, not by rerunning, deleting, or renaming old postings.

Keep console receipts separately for each invocation or append them; do not
treat one log timestamp as proof of one successful run. Successful posting
evidence is the ledger group and its stored creation/effective timestamps.
The script does not automatically create `scripts/out/` or a log file.

See [the fix, references, audit query, and verification](solved-problems/012-march-sweep-repeat-postings.md).

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
