# Backend load audit — 2026-10-30

Historical snapshot of the earlier audit at `9571805`. Later on the same day,
main gained [checkout capacity improvements](checkout-capacity.md) and the
[follow-up capacity fixes and new measurements](2026-10-30-capacity-follow-up.md).
The process/schema descriptions below describe the earlier run, not current deployment state.

Application code reviewed and exercised: main `9571805` (payment-link discount
fix). **Documentation only: no application, test, migration or dependency
source was changed during this audit.** Load generators and diagnostic
instrumentation ran from `/tmp/filspay-load-audit/`.

## Outcome

- The development API was restarted on the latest application code at
  **http://localhost:3000**. `/healthz` and `/readyz` answer successfully.
- Read-only scenarios passed the provisional latency/error criteria below.
- Checkout exceeded the 2-second p95 budget at **30 and 60 concurrent flows**.
  All requests still succeeded; no HTTP failures, driver timeouts, crashes or
  OOM kill were observed in these runs.
- Concurrent checkout also delayed otherwise-fast transaction reads: p95
  rose from **29.88 ms** in the standalone list test to **2,382.32 ms** in the
  mixed test. The two tests use different concurrency, so this is a contention
  observation, not a controlled estimate of a slowdown factor.
- The dominant measured checkout bottleneck is **connections held in open
  transactions during acquirer waits**. Its query count is fixed for one full
  checkout. Linear per-row SQL was separately confirmed in admin bulk KYC and
  status recompute. Transaction listing does not have an N+1 read pattern.

## Running backend and database

The old API process started at 13:01 Bahrain time and predated the latest
fixes. Its local database had 74 migrations through 0079. It was stopped;
the following existing migrations were applied, then the API was restarted:

- 0080 — platform cumulative-volume BIGINT counter.
- 0081 — reporting event receipts.
- 0082 — retain webhook history when deleting an endpoint.

The database now has **77 migrations** through 0082. No reporting or settlement
worker was running during migration. Existing development rows were not
reseeded and no historical finance correction or balance rebuild was run.
The development API retains its original environment/secrets, including its
normal acquirer simulation settings. Process start, source SHA-256 hashes,
schema count and readiness were recorded in the local `backend-start.json`.

## Environment and method

| Item | Value |
|---|---|
| Tool | Autocannon 8.0.0; Node driver for multi-request checkout flows |
| Runtime | Node 26.8.1 / PostgreSQL 18.6 |
| Host | 16 reported logical CPUs, about 7.4 GiB RAM; shared development host |
| API connection pool | Default maximum 5; connection acquisition timeout 5 seconds |
| Test API | Separate process on 3138; diagnostic process on 3139 |
| Load database | Disposable clone of a freshly migrated/seeded database |
| Initial dataset | 22,105 transactions total; 21,234 for Delta Wholesale |
| Synthetic expansion | 20,000 authorized transactions for Delta Wholesale; no card charges or ledger postings for that expansion |
| Checkout merchant | Seeded Delta Marketplace, 275-bps MDR / 1,250-bps negotiated discount |
| Acquirer | Repository simulator: 100–400 ms delay, deterministic seed 209, failure rate 0 |
| Resource observations | API RSS and `pg_stat_activity` sampled every 500 ms |

Authenticated sessions were obtained through password + OTP before the timed
runs. Login/Argon2 performance was not measured. Each checkout flow creates a
new 47,333-fil link and pays that unique link with a fresh idempotency key;
expected duplicate-link 409s were not treated as throughput or failures.

The write workload uses the simulated acquirer only. Load-generated payments
and admin mutations were confined to the disposable database. It did not
exercise live card/bank rails, settlement scheduling or production hosting.

Docker CLI was installed, but its daemon socket was unavailable. These runs
**did not enforce the deployment's 0.5-vCPU / 512-MB container limits**. The
results are a short local screening test, not a production capacity or soak
certification. PostgreSQL also differs from the architecture's target version
16. The earlier [FP-209 report](fp-209-loadtest-2026-09.md) used a different
runtime, dataset and resource envelope; its numbers are not directly comparable.

## Provisional criteria

These are explicit audit screening budgets, not an agreed production SLA:

- Read APIs: p95 below 500 ms.
- CSV export: p95 below 5,000 ms.
- Complete create-link + pay flow: p95 below 2,000 ms.
- Errors below 1% in each scenario.

Autocannon used one outstanding request per connection, without pipelining.
Reads ran for 12 seconds, except the 5-second health baseline. Checkout used
12-second closed-loop arrival windows; in-flight flows were allowed to drain.
Checkout throughput below uses the actual elapsed time including drain.
p95 was calculated from observed response/flow timings; HTTP status/error
counts were retained separately. No fixed open-arrival-rate claim is made.

## Baseline results

| Scenario | Concurrency | Completed requests/flows | Throughput/s | p95 ms | Errors | Result |
|---|---:|---:|---:|---:|---:|---|
| Health | 50 | 92,182 | 18,437.60 | 4.82 | 0 | Pass |
| Transactions, limit 50 | 50 | 23,233 | 1,936.09 | 29.88 | 0 | Pass |
| Transactions, absent substring search | 30 | 3,644 | 303.67 | 108.23 | 0 | Pass |
| CSV export, 90-day range | 3 | 120 | 10.00 | 386.64 | 0 | Pass |
| Settlement summary | 20 | 18,395 | 1,532.92 | 14.67 | 0 | Pass |
| Reconciliation | 20 | 18,364 | 1,530.34 | 14.93 | 0 | Pass |
| Checkout | 1 | 22 | 1.81 | 660.36 | 0 | Pass |
| Checkout | 10 | 118 | 9.25 | 1,348.26 | 0 | Pass |
| Checkout | 30 | 143 | 9.55 | 3,719.78 | 0 | **Latency fail** |
| Checkout | 60 | 176 | 9.60 | 6,296.03 | 0 | **Latency fail** |

The checkout flows contain two HTTP requests each. Their throughput is
**completed payments per second**, not individual HTTP requests per second.
The read date range was UTC today minus 90 days through tomorrow, passed as
business-date strings to the existing endpoint semantics.

## Findings and source references

### 1. Checkout occupies the shared connection pool during acquirer waits

[authorize.ts:81](../../apps/api/src/payments/authorize.ts#L81) starts a database
transaction before awaiting `acquirer.authorize` at line 117.
[capture.ts:188](../../apps/api/src/payments/capture.ts#L188) similarly awaits
capture while its transaction and transaction-row lock remain held. Checkout
composes capture, discount and paid-link finalization inside the same
transaction in [pay.ts](../../apps/api/src/paymentLinks/pay.ts).
The API uses the shared pool from [pool.ts:16](../../apps/api/src/db/pool.ts#L16),
with default size 5 in [config.ts](../../apps/api/src/config.ts).

At 10/30/60 concurrent flows, respectively **23/25, 26/30 and 33/37 samples**
showed five connections `idle in transaction`. That state means they were
holding transactions between SQL commands, not executing a slow query at
the sample instant. The p95 rises with concurrency while throughput stays
near 9–10 payments/s.

A single diagnostic pay request executed **35 SQL statements**, taking
563.83 ms overall, with 33.26 ms summed SQL spans and 0.23 ms measured pool
acquisition time in that otherwise-unloaded probe. This is a chatty but
fixed-size path, not a per-result-row N+1 read.

**Controlled configuration experiment:** a temporary instance kept pool size
5 and the same application code but set only simulated acquirer delay to
zero. Six-second payment-only runs produced:

| Checkout concurrency | Payments completed | Payments/s | p95 ms | Errors |
|---|---:|---:|---:|---:|
| 30 | 694 | 110.73 | 310.45 | 0 |
| 60 | 639 | 96.25 | 697.18 | 0 |

This supports acquirer waiting while occupying scarce connections as the
dominant baseline bottleneck. The zero-delay experiment is diagnostic; it
is not a fix or a realistic payment-provider latency assumption.

**Shared-pool impact:** a 20-second test with 30 checkout loops plus 10 list
connections produced 209 successful checkouts (9.20/s, p95 3,718.83 ms) and
191 successful list requests (9.56/s, p95 2,382.32 ms). Both latency budgets
failed, with zero HTTP errors. Payment pressure delays dashboard work too.

Future work should evaluate bounded concurrency/admission and pool usage
under the real deployment budget. Any redesign of the external-call boundary
must preserve durable idempotency, single-charge fencing and recovery. Simply
removing the transaction/row lock would undo previous correctness fixes.
No pool size, timeout, transaction boundary or acquirer setting was changed
on the development backend as a performance fix.

### 2. Bulk KYC performs two serial statements per approved merchant

[bulkKyc.ts:36](../../apps/api/src/admin/bulkKyc.ts#L36) loops over the selected
merchants. Each [recordKycReviewInTx](../../apps/api/src/onboarding/review.ts)
call inserts one review and updates one merchant. Observed complete HTTP
request counts, including auth, BEGIN/COMMIT and bulk audit:

| Merchants actually approved | SQL statements | Single-probe elapsed ms |
|---:|---:|---:|
| 1 | 8 | 5.59 |
| 10 | 26 | 11.30 |
| 100 | 206 | 57.82 |
| 200 | 406 | 108.21 |

The measured count is **2N + 6**. This is linear per-row SQL rather than a
classic N+1 SELECT pattern. The
[route cap of 200](../../apps/api/src/routes/adminMerchantsBulk.ts) bounds it,
and the probes did not fail the read latency budget. It remains a scaling
weak point, especially with network round-trip latency, not the cause of the
ordinary checkout benchmark failure. Per-merchant review/audit correctness
must be retained if this is later batched.

### 3. Status recompute issues an UPDATE per changed transaction

[transactionStatusRecompute.ts:26](../../apps/api/src/admin/transactionStatusRecompute.ts#L26)
loads and locks the merchant's candidate transactions without pagination.
Its line-43 UPDATE is awaited once for every status needing correction.

Controlled fixtures requiring 1, 10 and 100 corrections used **8, 17 and 107
SQL statements** (3.87, 5.42 and 28.00 ms). That is **N + 7** for changed rows.
Already-correct rows do not trigger per-row updates; do not describe every
scan as N+1. Large repairs still hold all candidate row locks and a pooled
connection while performing a linear sequence of writes. These were
single-request scaling probes, not a demonstrated HTTP timeout.

### 4. Full-memory CSV export approaches the stated memory budget

[exportCsv.ts:45](../../apps/api/src/transactions/exportCsv.ts#L45) reads all
matching rows, maps a second array of strings and joins a complete response.
The active route does not call the separate streaming helper. Date filters
are optional, so API callers are not constrained by a dashboard date picker.

With three concurrent 90-day exports on this dataset, sampled API RSS reached
**487.39 MiB**, compared with about **212.61 MiB** during the health baseline.
That leaves little margin against the architecture's 512-MB target. The
export's latency passed and **no OOM was reproduced**; this host did not enforce
512 MB, and 500-ms sampling can miss higher instantaneous peaks. Treat this
as measured memory pressure requiring a capped deployment test, not proof
of an OOM or an N+1 defect. The repository explicitly calls in-memory export
intentional; this audit does not change that design.

### 5. Absent substring search scans the transaction relation

[query.ts:111](../../apps/api/src/transactions/query.ts#L111) combines two
`ILIKE '%term%'` predicates and an `id::text` comparison. An actual
`EXPLAIN (ANALYZE, BUFFERS)` for the parameterized list query showed:

- Ordinary list: `idx_transactions_merchant_occurred`, 50 returned rows,
  53 shared-hit blocks, 0.370 ms execution in the isolated plan probe.
- Absent substring: sequential scan, **22,675 rows removed by filter**,
  456 shared-hit blocks at the scan, 15.307 ms total execution. The database
  had grown slightly with completed payment and diagnostic fixtures by then.

This is **one data query**, not one query per row. Under the standalone
load it passed at p95 108.23 ms, but work grows with history for a missing
substring. Search indexing/query shape should be evaluated separately from
the checkout pool bottleneck. No index was added.

## Query-count controls

Diagnostic request instrumentation was loaded into a separate process from
a temporary Node preload. It counted actual `pg.Client.query` calls within
an HTTP request, including session lookup and transaction-control statements.
Parameters and credentials were not written to the report. Baseline/mixed
timing runs used the uninstrumented application entry point.

| Request | Actual SQL statements |
|---|---:|
| Transaction list, limit 1 | 2 |
| Transaction list, limit 10 | 2 |
| Transaction list, limit 50 | 2 |
| Transaction list, limit 100 | 2 |
| Absent substring search | 2 |
| Reconciliation | 7 |
| Create payment link | 2 |
| Pay one fresh discounted link | 35 |

Do not optimize away authentication or financial/audit checks merely to
lower statement counts. The useful distinction here is a fixed request
cost versus a cost that grows with the number of entities in one request.

## Financial checks after load

Across the timed tests and checkout diagnostics, **2,002 newly paid Delta
links** had matching capture events. All 2,002 recorded fee 1,139 and rebate
163; none had a mismatched fee marker. There were **zero unbalanced ledger
groups** and **zero newly captured Delta transactions without a paid link**.
No settlement or bank payout was run as part of this load screen. These
checks supplement, rather than replace, the previous
[payment-link-to-payout verification](../fixes/payment-link-negotiated-discount.md).

## Reproduction and artifacts

See the [reproduction notes](2026-10-30-load-test-reproduction.md) for commands,
dataset expansion, scenarios and the checkout generator. Install tools in a
temporary directory to preserve the repository's dependency files.

Local artifacts under `/tmp/filspay-load-audit/` include:

- `backend-start.json`, `environment.json`: restart/source/schema provenance.
- `results.json`: baseline metrics and 500-ms resource/DB-state samples.
- `zero-latency.json`, `mixed.json`: controlled and mixed-load results.
- `query-trace.jsonl`: per-request statement counts and SQL timings, without
  bound values; `query-plans.json`: actual execution plans.
- `financial-check.json`: post-load money checks.
- API/load-generator logs. Environment and session-cookie files are private
  local test artifacts and are deliberately not committed.

The tables and findings above are the durable result. Temporary artifacts
are not a production monitoring system. The main development backend remains
running on port 3000; temporary load/diagnostic servers were stopped after
verification.
