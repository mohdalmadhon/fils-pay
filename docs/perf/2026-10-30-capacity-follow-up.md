# Capacity follow-up — 2026-10-30

## Result

The earlier capacity work is effective. An independent comparison found
**9.1–9.7 checkouts/s before it**, versus **36.8/s at 20 buyers afterwards**,
with buyer p95 dropping from 1.37–3.45 s to 756 ms. The changes in this
follow-up keep checkout at that level and substantially reduce admin work. They preserve TypeScript/Go, pricing, ledger legs,
transaction boundaries and public response shapes.

**The highest tested default-config step with no overload rejections and
buyer p95 below 1 s was 24 concurrent buyers: 38.2 completed checkouts/s,
p95 827 ms.** This is a measured local ceiling under the conditions below,
not a universal maximum for the backend or a production SLA. More buyers
continue to get successful payments, but some wait through 503/retry cycles.

A separate **120-second sustained run** at 24 buyers completed **4,555 payments
at 37.8/s**, buyer p95 **849 ms**, with **zero errors and zero 503s**. Across the
final version’s stepped and sustained runs, all **9,650** completed payments
passed the database integrity checks; no stale reservations remained.

## Review of the existing work

Reviewed the actual diffs and preserved their behavior:

| Commit | What it changes | Assessment |
|---|---|---|
| `35bb425` | Ledger group/transaction indexes (0083), deferred balance-cache update, reporting pass spacing | Addresses full ledger scans and merchant-row contention. The deferred ledger invariant remains active; balance updates still commit atomically. |
| `b6bc756` | Default pool 5 → 20, overload guard, checkout retry UI, cheaper logging | Explains the measured increase from ~10/s to ~37/s with normal acquirer latency. Rejected requests are counted separately from successes. |
| `2595430` | Connection error handlers, watchdog, shutdown limit, compose restarts | Useful recovery measures. This follow-up inspects them but does not repeat the destructive crash tests or validate Docker resource limits. |
| `0b094a9` | Checkout load and read-only database verification scripts | Reused for this review; corrected throughput timing as described below. |
| `556c49e` | Capacity/recovery documentation | The ~38/s claim is consistent with the independent local runs. Its stronger recovery guarantees apply to its simulator experiment, not proof of real acquirer atomicity. |
| `13d9c11` | Corrects unmeasured logging/lag/48-slot claims | Reviewed after fetching newer main. Updates comments and documentation only; no executable API behavior changes. The independent results here do not rely on those withdrawn claims. |

New main commits through `ad0ab10` arrived during this investigation. They add
submission/setup documents and helpers, plus the comment corrections above.
They are retained; none changes executable application behavior in these
benchmarks. The final integration is based on that newer main.

Baseline source: `c64b8dd` (`35bb425^`), before this capacity series.
Existing-capacity source: `556c49e`. Both run in detached temporary worktrees;
the final version runs from this working tree. Baseline alone lacks 0083's
two ledger indexes; all other schema is held constant. Each version starts
from a separate clone of the same seeded database, with the same keys and
simulator settings. This compares the series as a whole, not each fix in isolation.

A previous uncorrected-driver exploratory run is excluded from these tables.
The reported comparison runs use the corrected driver, without the test suite
running concurrently.

## Fixes in this follow-up

### Bulk KYC: write the review trail in a batch

The existing route selected and locked eligible merchants in ID order, then
issued an INSERT review plus UPDATE merchant for every selected merchant.
For the route's 200-merchant maximum that was 400 per-row writes.

`recordKycApprovalsInTx` now inserts one review per selected merchant with
`INSERT … SELECT unnest`, then updates the merchant from that review's
`RETURNING` row in the same SQL statement. The caller retains the selection,
locks, deduplication, sorted response, skip rules and single bulk audit row.
Reviewer identifier/admin FK, notes and transaction-stable review timestamps
are retained. An audit failure still rolls back all changes. Empty selections
create no reviews.

References: [bulk caller](../../apps/api/src/admin/bulkKyc.ts),
[canonical onboarding review writers](../../apps/api/src/onboarding/review.ts),
[unchanged authorization/200-ID limit](../../apps/api/src/routes/adminMerchantsBulk.ts),
[prior finding](2026-10-30-backend-load-audit.md),
[KYC review-history correctness fix](../future-fixes/24.md).

### Status recompute: send changed statuses in bounded batches

The old helper calculated each next status, then awaited a separate UPDATE
for each changed transaction. It now runs the **same** `nextStatusAfterRefund`
and integer-fils conversions, collects changed IDs/statuses, and sends batches
of up to 500 through `UPDATE … FROM unnest`. Every candidate remains locked
inside the caller's transaction. Authorized/voided exclusions, scanned and
updated counts, the separate open-authorization count, audit and merchant
flags remain unchanged. Already-correct rows receive no UPDATE.

This reduces round trips; it does not make the initial candidate scan or its
row-lock set bounded. A very large backfill still belongs in a quiet window.

References: [recompute helper](../../apps/api/src/admin/transactionStatusRecompute.ts),
[unchanged status rules](../../apps/api/src/payments/refundState.ts),
[route/audit](../../apps/api/src/routes/adminMerchantsRecompute.ts),
[test-mode correctness fix](../solved-problems/010-test-merchants-in-settlement.md),
[prior query-count evidence](2026-10-30-backend-load-audit.md).

### CSV projection withheld to preserve output compatibility

A trial selected only CSV's six output columns to avoid decoding unused fields.
It was faster on the initial fixture, but an additional check with 200 equal
occurrence timestamps changed the relative order of tied rows. The original
query orders only by timestamp; changing row width can change PostgreSQL's
sort plan. Adding a new tie-breaker would also change existing output.

The projection was removed. **The CSV source is byte-for-byte unchanged.**
The comparative verification now includes tied timestamps and confirms equal
CSV bytes, filters, escaping and empty-result behavior. No CSV throughput gain
is claimed, and the earlier audit's export-memory concern remains open.

References: [unchanged CSV builder](../../apps/api/src/transactions/exportCsv.ts),
[earlier memory observation](2026-10-30-backend-load-audit.md),
[comparative check](../../scripts/load/capacity-paths.verify.mjs).

### Capture: insert gross and fee legs together

A nonzero-fee capture previously used two INSERT statements for its four
ledger legs. It now sends those four unchanged legs in one statement. Zero-fee
captures still write only their two gross legs. Group ID, amounts, directions,
descriptions and `now()` timestamps are unchanged. The deferred balance trigger,
cache hook, acquirer lock, outbox, timeline and idempotency handling are intact.
This saves one SQL round trip per fee-bearing capture; the default pool still
limits checkout throughput while connections wait on the acquirer.

References: [capture posting](../../apps/api/src/payments/capture.ts),
[ledger invariant](../../db/migrations/0007_ledger_double_entry.sql),
[existing ledger indexes](../../db/migrations/0083_ledger_entries_group_and_transaction_indexes.sql),
[balance-cache hook](../../apps/api/src/payments/balanceCache.ts),
[pricing/checkout correctness](../fixes/payment-link-negotiated-discount.md).

### Measure completed throughput including drain time

The load driver allowed requests launched before a step's deadline to finish,
but divided all completions by just the arrival window. This inflated the rate,
especially when the server queued work. It now records the actual elapsed time
including drain, plus the arrival window separately. A passing capacity step
also requires buyer p95 (including waits) within the budget and a remaining
supply of links, as well as zero overload responses/recovered failures/errors.
Instant 503s remain excluded from successful-checkout latency; both counts and
buyer latency are reported. A supply-limited run cannot claim server capacity.

Reference: [checkout load driver](../../scripts/load/checkout-load.mjs).

## Measured admin improvements

Same disposable database and fixtures, API/DB on one logical CPU; one warm-up
and six measured samples per implementation, median wall time. SQL counts
include BEGIN/COMMIT for transactional helpers and exclude fixture setup and
HTTP authentication. These are helper timings, not end-user HTTP capacity.

| Operation | SQL before → after | Median before → after | Local speedup |
|---|---:|---:|---:|
| Approve 200 merchants | 405 → 6 | 120.095 → 7.893 ms | 15.2× |
| Recompute 1,001 changed statuses | 1,005 → 7 | 222.215 → 27.057 ms | 8.2× |

These medians describe the recorded repeat run and vary with host load, cache
and fixture history. An earlier run measured 78.9 → 6.3 ms and 202.7 → 29.9 ms
respectively; SQL-count reductions are stable across both. No concurrency
ceiling for admin endpoints is inferred from single-operation timings.

The comparative verification passes eight groups of checks: review fields/audit,
KYC skip/deduplication, concurrent approval, audit rollback, status parity and
repeat behavior, status rollback, capture/ledger/idempotency parity, and CSV byte
parity. Normal-fee capture uses **15 → 14 SQL calls**; zero-fee capture stays at
14. These capture counts include BEGIN/COMMIT and assume an existing balance
cache row for both versions. No cached financial read or fee formula changed. The CSV check covers 20,000
rows, 200 timestamp ties, null/quoted/newline/formula references and date/status
filters; the export implementation is unchanged.

Final verification:

- `npm test`: events 4/4, money 40/40, API **547/548**, reporting 12/12,
  web 25/25. One unrelated analytics query-plan assertion fails on this
  PostgreSQL 18 database. The same test **also fails at unchanged `556c49e`**,
  using `idx_transactions_merchant_occurred` with `created_at` as a filter
  rather than the index condition the assertion requires. No test was edited.
- Because `npm test` short-circuits before root tests when a workspace fails,
  the 11 root regression checks were also run directly.
- Uncached `go test -count=1 ./...`: all packages pass.
- Workspace `npm run typecheck` and `npm run test:db` (6 checks): pass.
- The eight comparative check groups in `capacity-paths.verify.mjs`: pass,
  including exact CSV bytes with tied timestamps after removing the projection.

The final full run starts from a fresh restored seed. A prior rerun on the same
DB after the Go suite also exposed four reporting exceptions from processing
leftover fixture batch events with no daily rollup (`applyEvent.ts:148`); a
fresh DB removes that fixture contamination. These failures and the planner
assertion are recorded rather than changing unrelated code or locked tests.
An early diagnostic run was deliberately paused and tripped the existing lag
guard once; it is not used as a correctness or capacity result.

References: [planner assertion](../../apps/api/src/analytics/queryPlans.test.ts#L114),
[existing reporting rollup assumption](../../apps/reporting/src/consumer/applyEvent.ts#L148).

## Checkout capacity and overload

| Concurrent buyers | Completed/s | Accepted p95 | Buyer p95 incl. retries | 503 retries | Terminal 503 | Unexpected errors |
|---|---:|---:|---:|---:|---:|---:|
| 10 | 18.2 | 773 ms | 773 ms | 0 | 0 | 0 |
| 20 | 36.8 | 738 ms | 738 ms | 0 | 0 | 0 |
| 24 | 38.2 | 827 ms | 827 ms | 0 | 0 | 0 |
| 30 | 37.2 | 822 ms | 856 ms | 120 | 0 | 0 |
| 40 | 37.8 | 830 ms | 849 ms | 320 | 14 | 0 |
| 80 | 37.1 | 855 ms | 3655 ms | 1120 | 43 | 0 |
| 120 | 36.8 | 855 ms | 7558 ms | 1920 | 81 | 0 |

20-second arrival windows, followed by drain. Each checkout loads a precreated
payment link, then pays it. Setup/login/link creation and verification are
outside the timed window; this is **buyer checkout capacity**, not a promise
that simultaneous merchant-link creation is free. Retry-After is honored.
Terminal 503 means a buyer exhausted the step while still refused. All such
links remain unpaid. Accepted p95 subtracts retry delay; buyer p95 includes it.

At 20 buyers, the existing-capacity version measured **36.8/s, p95 756 ms**;
the final version measured **36.8/s, p95 738 ms**. This does **not** demonstrate
a material checkout-throughput gain from the additional ledger batching; the
pool/acquirer wait remains the limiting factor at these settings. Admin improvements are measured separately above.

The 120-buyer step keeps the server responding but buyer p95 reaches **7.558 s**.
That is overload survival, not acceptable capacity under the 1-second budget.
The capacity script's final database/HTTP checks must also pass before using
any rate as a capacity estimate.

## Environment and limits

- AMD Ryzen 7 260 host, 16 logical CPUs, ~7.4 GiB physical RAM; shared workspace.
  API, reporting worker and **a separate disposable Postgres cluster, including
  its children, share logical CPU 2** via `taskset`. Driver uses CPU 3. No cgroup
  CPU/RAM limit is imposed; this is not a 512/768-MB container certification.
- Node 26.8.1, PostgreSQL 18.6. API heap cap 384 MiB, reporting heap cap 128 MiB,
  Postgres shared_buffers 32 MiB, max_connections 60. Original dev Postgres and
  frontend processes are not load targets. Shared-host memory/swap activity
  means these are local measurements, not guaranteed dedicated-server results.
- Final and existing-capacity API: pool 20, max in-flight 32, general-request
  share 24, queue threshold 10, lag threshold 2 s; existing reporting minimum
  pass gap 500 ms. Baseline: original pool 5 and no overload guard.
- Acquirer simulator: two 100–400 ms calls per checkout, RNG seed 209,
  injected failure rate **0**, so successful-payment cost is measured without
  deliberate declines. Original capacity document used 2%; rates are not
  expected to match exactly. Normal development failure settings are retained.
- Fresh seeded Alpha Retail per comparison version; no settlement daemon or
  concurrent admin/export load. The reporting worker is enabled. The tests
  exercise real Postgres commits, ledger constraints, caches, events and
  reporting; they do not contact banks or measure remote-provider behavior.
- No crash/OOM occurred in these runs. This is a short capacity screen and a
  two-minute sustained check, not hours of soak or a production traffic mix.
  No universal "maximum users" follows from it: think time, merchant mix,
  exports, webhook receivers, hardware and provider latency all matter.

500-ms sampling during the latter stepped tests, inter-test idle time and the
sustained run observed API peak RSS **210.55 MiB**, reporting **83.33 MiB**, and
maximum sampled event-loop delay **36 ms**. Sampling can miss brief peaks; this
is not a hard memory bound and excludes concurrent large CSV exports.

## Reproduce

Use an isolated migrated/seeded database and the same required development
secrets for seed/API. Do not point fixture/load scripts at production. Save the
schema and seed once, then clone it for each source version. Stop one version's
API/reporting before starting the next. Pin the dedicated database postmaster
before it spawns children if reproducing the single-CPU layout. Source worktrees
should be `c64b8dd`, `556c49e`, and this commit. The baseline schema must omit
0083's two indexes; never remove them from a shared or production database.

```bash
# API: isolated env with DATABASE_URL and normal required keys already exported.
export NODE_ENV=development OTP_DEV_EXPOSE=true PORT=3150
export ACQUIRER_FAILURE_RATE=0 ACQUIRER_RNG_SEED=209
export ACQUIRER_LATENCY_MIN_MS=100 ACQUIRER_LATENCY_MAX_MS=400
export PG_POOL_MAX=20
node scripts/load/verify-db.mjs --baseline
# In separate terminals, same disposable database, pinned to the same CPU:
taskset -c 2 node --max-old-space-size=384 --import tsx apps/api/src/index.ts
taskset -c 2 node --max-old-space-size=128 --import tsx apps/reporting/src/index.ts worker
# Wait for /readyz. Driver on another CPU:
API_URL=http://127.0.0.1:3150 STEPS=10,20,24,30,40,80,120 \
  STEP_SECONDS=20 P95_MS=1000 REPORT=scripts/out/capacity-final.json \
  taskset -c 3 node scripts/load/checkout-load.mjs
API_URL=http://127.0.0.1:3150 STEPS=24 STEP_SECONDS=120 P95_MS=1000 \
  REPORT=scripts/out/capacity-sustained.json \
  taskset -c 3 node scripts/load/checkout-load.mjs
node scripts/load/verify-db.mjs
```

For the repeated helper comparisons, use **another** disposable seeded database;
stop load first. This verification script writes fixture rows and refuses to
start without explicit fixture mode:

```bash
git worktree add --detach /tmp/filspay-capacity-friend 556c49e
# Install the baseline checkout's dependencies if needed.
mkdir -p scripts/out
CAPACITY_FIXTURE_DB=1 \
  BASELINE_API_SOURCE=/tmp/filspay-capacity-friend/apps/api \
  CAPACITY_REPORT=scripts/out/capacity-paths.json \
  node --import tsx scripts/load/capacity-paths.verify.mjs
```

The raw compact measurement record is
[capacity-follow-up-results.json](capacity-follow-up-results.json).
Local full logs/resource samples are in `/tmp/filspay-capacity-20261030/` and
may not persist. Reports contain no cookies, OTPs, API keys or database passwords.

## Remaining constraints

- Pool slots are still intentionally held across acquirer calls to preserve
  payment concurrency/idempotency guarantees. This change does not remove those
  locks or suggest caching financial reads.
- CSV is still unbounded in memory; status candidate selection still locks the
  whole candidate set. Batching reduces SQL round trips, not all scaling limits.
- Search substring scans identified in the earlier audit are unchanged.
- Original recovery work was not re-crash-tested here; real acquirer side effects
  cannot be undone by rolling back a database transaction. Existing tests prove
  local/simulator invariants, not distributed exactly-once charging.

## Local running state

The development API was restarted from the final application source on
**http://localhost:3000**, retaining its original environment, secrets and
normal simulator failure settings. `/healthz` and `/readyz` answer 200. The
local development database now has **80 applied migrations**, through 0083;
this run applied the existing 0080 platform-stats, 0081 signup and 0083 index
files that were missing. No new migration is introduced by these batching
changes, and no seed or finance rebuild was run against development data.

Temporary load APIs/reporting workers were stopped. The disposable capacity
Postgres cluster is stopped after final validation; the normal development
Postgres and frontend processes are left running. Deployments elsewhere need
the existing 0083 index migration before expecting the prior capacity gains;
this follow-up changes no pool, overload or provider-latency defaults.
