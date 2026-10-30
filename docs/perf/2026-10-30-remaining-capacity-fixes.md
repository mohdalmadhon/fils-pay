# Remaining capacity fixes — 2026-10-30

## Scope and outcome

Baseline: main `11919ca`. This follows the [first capacity fixes](2026-10-30-capacity-follow-up.md).
The user authorized implementation after reviewing eight possible improvements,
with the explicit requirement: **do not break expected outputs**. The hosting
budget is a 1-vCPU / 2-GB server, with API <= 0.5 vCPU / 512 MiB.

The existing TypeScript API/reporting and Go settlement architecture is retained.
Changes reduce search work, SQL round trips, export memory and startup time.
No monetary helper, pricing formula, settlement rule, auth/tenant rule, API
response schema or eligible webhook event type is changed. The full export
remains a single buffered HTTP response. No Redis, queue service, database
service, language rewrite or extra API replica is introduced.

## Changes and preservation rules

### 1. Index all transaction-search branches (FP-244)

Migration **0084** adds PostgreSQL's `pg_trgm` extension, GIN indexes for
`reference` and `acquirer_reference`, and a B-tree expression index for
`id::text`. All three branches matter: an unindexed branch of the OR can
otherwise prevent efficient lookup. The application search SQL is unchanged.

Substring/ILIKE behavior, wildcard meaning, exact textual UUID matching
(including case behavior), tenant/date/status filters and `(occurred_at,id)`
keyset pagination stay unchanged. Comparison checks drop these indexes inside
an isolated transaction, read the old results, roll back the DDL, then compare
indexed results and cursors. No shared/production index is dropped.

The helper benchmark VACUUMs/ANALYZEs its synthetic data before measuring.
That flushes GIN's bulk-insert pending list. An initial post-insert run still
scanned and showed little gain; the settled-index plan uses all three indexes.
Do not present that settled-index timing as guaranteed immediately after a
large import. GIN consumes disk and adds write/maintenance work; short or broad
wildcards can still scan many rows. Checkout was screened with the new indexes.

References: [migration](../../db/migrations/0084_transaction_search_indexes.sql),
[unchanged search query and FP-244 comment](../../apps/api/src/transactions/query.ts),
[earlier scan evidence](2026-10-30-backend-load-audit.md).

### 2. Create webhook deliveries in one bounded INSERT

The dispatcher still selects at most 500 eligible event/endpoint pairs using
its existing query. It generates each delivery ID and builds each envelope
through the existing mapper, then inserts the batch with typed parameter arrays.
`WITH ORDINALITY` preserves selected insertion order. The existing partial
unique conflict target remains authoritative for original deliveries.

`createdCount` comes from the actual inserted row count. Event eligibility,
no-backfill registration cutoff, active endpoint/superseded-event filters,
payload fields, generated per-delivery identity and transaction atomicity are
unchanged. A repeat pass creates no extra original deliveries.

References: [dispatcher Step A](../../apps/api/src/webhooks/dispatcher.ts),
[unchanged envelope mapper](../../apps/api/src/webhooks/envelope.ts),
[existing dispatcher regressions](../../apps/api/src/webhooks/dispatcher.test.ts).

### 3. Send to independent endpoints with bounded concurrency

The existing due-delivery selection/cap is retained. Selected rows are grouped
by endpoint, preserving their selected order, and up to **four endpoint queues**
run at once. A queue never overlaps its own requests. Each send still rechecks
that the endpoint is active, signs the actual body, runs the existing
idempotent payout effect, and uses the existing timeout/retry/state handling.
A pause after one send prevents subsequent sends from that endpoint's queue.
Already-started network requests cannot be recalled, as before.

Cross-endpoint completion order is intentionally concurrent; there was no
cross-endpoint ordering guarantee. Per-endpoint selected order and all delivery
payloads/signatures/states are checked. `attemptedCount` keeps its previous
meaning (selected due rows, including rows subsequently skipped after pause).
The dispatcher still assumes one live API dispatcher: this is not a claim or
lease mechanism for multiple API replicas, nor exactly-once webhook delivery.

References: [dispatcher Step B](../../apps/api/src/webhooks/dispatcher.ts),
[signature implementation](../../apps/api/src/webhooks/sign.ts),
[existing payout-effect uniqueness](../../apps/api/src/webhooks/payoutDisbursement.ts),
[pause correctness](../future-fixes/22.md).

### 4. Batch reporting receipts, retaining event order

The reporting consumer claims its selected batch with one INSERT into
`reporting_processed_events`, collecting only returned IDs. It applies those
events through the existing applier **in the original event order**. Receipt
rows, rollups and cursor advancement still commit or roll back together under
the same locked consumer cursor.

Rollup writes are deliberately not grouped: batch-close checks can depend on
previous events in that pass. No ID-watermark eligibility shortcut is added;
a lower ID that commits later remains eligible. Empty/repeat passes and
concurrent consumers preserve their original results. A malformed event rolls
back every receipt and rollup in its pass.

References: [consumer pass](../../apps/reporting/src/consumer/runConsumerPass.ts),
[unchanged event appliers](../../apps/reporting/src/consumer/applyEvent.ts),
[cursor serialization](../../apps/reporting/src/consumer/cursor.ts),
[receipt/commit-order fix](../future-fixes/10.md).

### 5. Batch adjustment-import details, retaining financial sequencing

The importer buffers at most **500 detail records** and inserts them together.
It retains the canonical `postLedgerAdjustment`, each row's balance-cache
operation, the existing parser, and running `addFils` calculation in input order.
This preserves intermediate signed arithmetic/overflow behavior rather than
aggregating financial updates into a different calculation.

Each row still has its original row number, raw amount, parsed integer, reason,
zero-or-one ledger group and exact ledger legs. Zero rows still have no ledger
group. Signed totals retain existing behavior (the historical interface comment
calling them absolute is not a rule change). One audit is last in the same
transaction. Invalid input after a flushed batch or a failed audit rolls back
the entire import. Filename/re-upload behavior is unchanged.

References: [importer](../../apps/api/src/admin/adjustmentImport.ts),
[unchanged parser](../../apps/api/src/admin/adjustmentCsvParsing.ts),
[unchanged ledger writer](../../apps/api/src/admin/ledgerAdjustments.ts),
[amount parsing fix](../solved-problems/006-adjustment-import-bhd-parsing.md).

### 6. Buffer CSV lines without retaining all decoded rows

The export executes the **same SELECT, parameters and ORDER BY**. A pg Query
row listener formats rows as received, retaining CSV lines instead of also
accumulating all decoded transaction objects. It joins those lines into the
same single response; no HTTP streaming, paging, resumable download, column
projection or new tie-breaker is introduced.

A formatting exception is saved while the query drains; the client is released
only after query completion, then the original exception is thrown. SQL errors
still take priority, as they did when fetching all rows first. Header, escaping,
null references, three-decimal amounts, filters and trailing-newline behavior
are compared. Empty results still return just the header.

**Timestamp ties:** on the larger fixture PostgreSQL selected a parallel
Gather Merge. Two unchanged baseline exports already produced different order
among timestamp ties. The comparative script disables parallel query **only
on its own test connections**, identically for both versions, to compare exact
bytes under a deterministic plan. Production query/config is unchanged; this
fix retains whatever row order PostgreSQL returns and does not promise a new
order for pre-existing ambiguous ties. This differs from the projection rejected
in the earlier capacity work: the database row width/SQL is retained here.

The final CSV string/line storage is still proportional to output size; this
reduces memory retention but does not make arbitrary exports fit 512 MiB.

References: [export builder](../../apps/api/src/transactions/exportCsv.ts),
[existing export tests](../../apps/api/src/transactions/exportCsv.test.ts),
[earlier projection compatibility finding](2026-10-30-capacity-follow-up.md).

### 7. Compile existing TypeScript for the Node services

`npm run build:node` uses esbuild **0.28.2**, already present transitively and
now pinned directly as a build dependency. API/reporting entrypoints and their
local workspace imports compile to `build/node/*.mjs`, targeting Node 22 with
source maps. External packages/native dependencies remain external. Money
source is read unchanged; no frozen file or package export is modified.

Docker builds the artifacts and runs them with `node --enable-source-maps`.
Migration/seed commands remain tsx, so the shared image still includes dev
build tooling. Source-mode local startup remains supported. Generated artifacts
are excluded from Git and Docker's source context; the image builds its own.

Three warm-filesystem startup samples per mode show median readiness **1,199.90
→ 535.73 ms**. Ready RSS was similar (~122.5 vs ~119.7 MiB); no large runtime
memory or checkout-throughput gain is attributed to compilation.

References: [build script](../../scripts/build-node.mjs),
[package scripts/lock](../../package.json),
[Dockerfile](../../ops/Dockerfile.node),
[compose commands](../../ops/docker-compose.yml).

### 8. Align the API budget; retain measured connection defaults

Compose now sets **cpus: 0.5**, **mem_limit: 512m** and a **320-MiB V8 heap**.
The previous API limit was 768 MiB with a 512-MiB heap and no CPU quota. The
heap is below the process cap to leave native/buffer/thread overhead room.
Reporting/settlement and PostgreSQL retain their existing settings. Pool 20 and
Postgres max_connections 120 are not increased without evidence that it helps
the whole 1-vCPU/2-GB budget. No durability setting or lock is relaxed.

Static Compose validation uses `--no-env-resolution` and placeholder
interpolation values because the local `ops/.env.docker` is absent. The Docker
daemon is unavailable and this environment's cgroup hierarchy is not writable;
container hard limits and the combined 2-GB host have **not** been load-validated.
Existing ~37–38/s results must not be described as certification of that budget.

References: [Compose limits](../../ops/docker-compose.yml),
[resource/run instructions](../../ops/README.md),
[architecture target](../ARCHITECTURE.md).

## Measured helper comparisons

One recorded call per operation, same disposable database/fixtures, baseline
`11919ca` versus the new helpers. The API/helper driver and disposable PostgreSQL
share logical CPU 2; no production database is used. These are individual
operation timings, not p95 values or guaranteed speedups. The benchmark has
20,000 wide transactions for one merchant among history left by earlier fixture
runs; the ~500-character acquirer field and settled GIN state affect timings.

| Operation | SQL before → after | Wall time before → after |
|---|---:|---:|
| Absent transaction search | 1 → 1 | 92.273 → 2.110 ms |
| 1,001-row signed/zero adjustment import | 2757 → 1759 | 572.201 → 409.748 ms |
| 500 reporting events | 1006 → 507 | 179.501 → 100.843 ms |
| 80 webhooks, 4 endpoints, injected 5-ms receiver delay | 244 → 165 | 612.938 → 185.869 ms |

CSV child-process peak RSS: **128.89 → 96.66 MiB**, with identical
**1,985,135-byte** CSV hashes. Both subprocesses import only their selected export
implementation; peak includes Node/tsx, not just row storage. This is a fixture
measurement, not an upper memory bound. Webhook peak concurrent sends was
**1 → 4**, and each endpoint still had at most one.

## Output verification and regression checks

The reproducible [comparative verification](../../scripts/load/capacity-remaining.verify.mjs)
passes six groups covering:

- Indexed/unindexed search DTOs and cursors, wildcards/UUID spelling and pagination.
- CSV bytes, escaping, filters and timestamp ties under the same deterministic
  test plan; formatting-error parity and usable connections after errors.
- Import rows, signed totals, ledger legs, cache and audit metadata; malformed
  input and audit failure after batch boundaries.
- Reporting rollup/receipt/cursor parity, repeat passes and concurrent consumers.
- Reporting rollback and late-committing lower event IDs.
- Webhook body fields, valid raw-body signatures and header IDs, resulting
  delivery state, selected per-endpoint ordering, bounded concurrency and pause.

Only naturally generated IDs/timestamps are normalized where two independent
writes must differ. Referenced row IDs and payload values are otherwise checked.
No regression-locked test file is changed. Frozen money source is unchanged.

Regression results:

- Full `npm test`: events 4/4, money 40/40, API 547/548, reporting 12/12,
  web 25/25. The one analytics created-at index-plan assertion is the same
  pre-existing failure reproduced at baseline during the previous capacity
  audit; it is unrelated to these paths. No test assertion was edited.
- Root regression checks, run separately because the workspace failure
  short-circuits them: 11/11. `npm run test:db`: 6/6, including applying all
  migrations to an empty database and checksum/idempotency checks.
- Uncached Go suite and workspace typecheck: pass. Node build and static
  Compose validation: pass. The comparative script's six check groups pass.
- Real compiled Node **22.23.4** API/reporting plus Go settlement: Alpha and
  discounted Delta Marketplace each pass all **20** existing end-to-end checks.

The suite ran against a fresh disposable clone; correctness tests and helper
measurements were separate. A short database-check job overlapped the start
of the baseline checkout screen, so its timing is not a controlled estimate
of a throughput difference. No throughput improvement is attributed to that
small before/after difference.

## Checkout/load and runtime compatibility

| Version | Buyers | Completed/s | Accepted p95 | Buyer p95 | Retry 503s | Terminal 503 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| 11919ca source/tsx | 24 | 36.9 | 853 ms | 853 ms | 0 | 0 | 0 |
| 11919ca source/tsx | 60 | 37 | 854 ms | 989 ms | 720 | 25 | 0 |
| New compiled services | 24 | 37 | 847 ms | 847 ms | 0 | 0 | 0 |
| New compiled services | 60 | 37.1 | 849 ms | 882 ms | 720 | 29 | 0 |

All post-load integrity checks pass on both databases. Baseline completed
**1,551** payments; the new compiled version **1,548**. Checks cover balanced
ledger groups, exactly one full capture per paid link, no stray/double captures,
capture event/outbox presence and unchanged cache-versus-ledger drift. Every
HTTP outcome is also checked by the load driver. The observed ~37/s remains
consistent with the previous run; the changes improve specific work, without
claiming a new checkout ceiling.

The scenario loads then pays precreated links. It excludes login/link creation
and measures a 20-second arrival window plus actual drain, with zero injected
acquirer failures and normal two-call 100–400-ms simulator delays. Pool is 20;
reporting runs on the same CPU. This is a regression screen, not a claim of a
new maximum checkout rate. Step 60 includes overload/retries and is not a
passing capacity step despite successful accepted requests.

Node 26.8.1/PostgreSQL 18.6 on the shared Ryzen host, API/reporting/Postgres
pinned to one logical CPU, generator on another. API uses a 320-MiB heap;
reporting 128 MiB; Postgres shared_buffers 32 MiB. The half-CPU/512-MiB container
quota and whole-host 2-GB ceiling are not enforced in these local tests.

The Node 22.23.4 binary was downloaded from the official Node distribution and
checked against its published SHA-256 manifest. On a **separate fresh fixture**,
the compiled API/reporting and newly built Go CLI pass link creation/payment,
second-pay refusal, timeline/fee consistency, balanced ledger, signed capture
webhook, paid settlement, scheme residue, payable clearance, signed settlement
webhook and zero-gap reconciliation. Alpha: 47,333 gross / 1,065 fee / 46,268 net.
Delta Marketplace: **10,021 gross / 241 fee / 9,780 net**, including negotiated
discount and split-payout processing. A separate database check confirms the
three child allocations (2,934 + 1,956 + 4,890) sum exactly to **9,780 fils**.
These are simulator/local receiver checks.

An initial E2E run reused the load-test merchant and failed the driver's
single-payment payable assertion: it compared the newest capture with a payout
for the whole 1,549-payment batch. Its ledger and reconciliation checks passed.
The two reported E2E runs use a fresh database and both pass 20/20. No application
or existing verification assertion was changed to conceal that fixture issue.

## Deployment and reproduction

Apply 0084 with the migration owner before expecting indexed-search gains.
`pg_trgm` must be available. The runner wraps migrations in a transaction, so
these CREATE INDEX operations block writes; use a quiet deployment window.
No historical finance repair or rebuild is required. Review index disk/write
cost against representative data; no old applied migration is edited.

```bash
npm ci
npm run migrate
npm run build:node
# Existing production environment and secrets already configured:
node --enable-source-maps build/node/api.mjs
node --enable-source-maps build/node/reporting.mjs worker
```

For comparative verification, use a separate migrated, disposable database.
The script writes fixtures and disables its database's existing webhook
endpoints to prevent accidental receiver traffic. Never point it at shared data.

```bash
git worktree add --detach /tmp/filspay-capacity-baseline 11919ca
# Install baseline dependencies if needed; current checkout: npm ci && npm run migrate
CAPACITY_FIXTURE_DB=1 BASELINE_REPO=/tmp/filspay-capacity-baseline \
  CAPACITY_REPORT=scripts/out/remaining-capacity.json \
  node --import tsx scripts/load/capacity-remaining.verify.mjs
```

Run `scripts/load/verify-db.mjs --baseline` before checkout load, the existing
checkout driver at 24/60 buyers afterwards, and the database verifier again.
Separate databases per version keep seed/pricing/history comparable. Do not
run tests or other database workloads while collecting capacity figures.

Recorded measurements: [remaining-capacity-results.json](remaining-capacity-results.json).
Full temporary logs are under `/tmp/filspay-capacity-wave2/` and may not persist.

## Local running state

The normal development API is restarted on http://localhost:3000 using the new
compiled build, Node 22, and its original development environment/secrets. The
existing development database is migrated through **0084**; no reseed or
historical finance correction is run there. Readiness and liveness return 200.
Temporary load API/reporting processes and their separate PostgreSQL cluster
are stopped after verification. Normal development PostgreSQL/frontends remain
running. Docker deployment/resource enforcement remains unverified here.

## Publication

During this work remote main was force-reset from `11919ca` to `ad0ab10`.
That remote state is preserved. The prior capacity fixes and this follow-up
are published together on **capacity-improvements**, rather than silently
restoring the removed commit to main. The running local API uses this branch's
compiled code. No remote production deployment was performed.
