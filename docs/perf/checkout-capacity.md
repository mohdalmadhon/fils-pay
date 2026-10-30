# Checkout capacity, overload and recovery

| | |
|---|---|
| **Date** | 2026-10-30 |
| **Author** | malmadhoo |
| **Question** | How many buyers can check out at once while checkout stays fast and correct; what happens past that; does the stack restart itself and recover without losing data? |
| **Hardware** | 1 vCPU / 1-2 GB, as the hosted box on Dilmun Cloud: Postgres, the API and the reporting worker all pinned to **one core** (Intel Xeon @ 2.10 GHz); the load generator on a separate core |
| **Scripts** | `scripts/load/checkout-load.mjs` (load and correctness), `scripts/load/verify-db.mjs` (database checks) |

## The estimate

**About 38 checkouts a second (roughly 2,300 a minute) on one vCPU, with
p95 checkout time under 1 second and no errors.**

| Buyers checking out at once, back to back | Checkouts/s | p95 (accepted) | Buyer p95 incl. waits | Asked to retry (503) | Errors |
|---|---|---|---|---|---|
| 10 | 19.3 | 0.74 s | 0.74 s | 0 | 0 |
| **20** | **37.7** | **0.75 s** | **0.75 s** | **0** | **0** |
| 25 | 38.6 | 0.85 s | 0.87 s | 30 | 0 |
| 30 | 38.1 | 0.86 s | 0.89 s | 180 | 0 |
| 40 | 38.1 | 0.87 s | 0.91 s | 480 | 0 |
| 60 | 38.7 | 0.84 s | 0.92 s | 1,080 | 0 |
| 100 | 38.8 | 0.88 s | 10.6 s | 2,280 | 0 |
| 200 | 38.6 | 0.87 s | 13.7 s | 5,280 | 0 |

(Fresh, seeded database; 30 s per step; the acquirer simulator at its live
defaults: 100-400 ms per call, two calls per checkout, 2 % declines.)

Read it as:

- **Up to ~20 buyers checking out back to back** (no pause between
  checkouts) are served with no waiting at all: p95 0.75 s.
- **Up to ~60** are served with p95 under 1 s, a few of them asked to wait
  a second first.
- **Past that**, throughput holds at ~38/s and every checkout let in stays
  under 1 s; the excess is turned away at once with `503` and
  `Retry-After: 1`, never charged, and gets in when it retries.
- **Buyers who pause between checkouts:** the box serves about
  `38 x (pause + 0.7 s)` of them, e.g. ~210 buyers who each pay every 5 s.

A checkout is two requests: load the link (`GET /v1/payment-links/:token`)
and pay it (`POST /v1/payment-links/:token/pay`). Most of the 0.6 s a
checkout takes is the acquirer's two round trips; one core is the limit on
throughput.

**Calibrate on the live box before sending a final number**: a cloud vCPU
can be faster or slower than this one, and throughput scales with it. See
"Running it on the live server" below; one run takes about 5 minutes.

## What limited it, and the fixes

The first run, on the code as it was, served **10 checkouts a second** no
matter how many buyers waited, then failed with 500s:

| Buyers | Checkouts/s | p95 | Errors |
|---|---|---|---|
| 5 | 9.4 | 0.73 s | 0 |
| 20 | 10.3 | 2.4 s | 0 |
| 80 | 12.1 | 9.0 s | 0 |
| 160 | 14.6 | 13.4 s | 156 (500: no database connection within 5 s) |

Each fix below was found by measuring, in this order:

| # | Found | Where | Fix | After |
|---|---|---|---|---|
| 1 | Only 5 database connections, each held while the acquirer answers (authorize and capture keep their transaction open across the network call, on purpose). 5 connections / ~0.55 s = ~10 checkouts a second, CPU mostly idle. | `apps/api/src/config.ts` (`PG_POOL_MAX`, default 5), `db/pool.ts` | Default 20. On one core 20 reaches the CPU's limit; 40 is no faster. | ~37/s on a small database |
| 2 | Getting slower as the database grew (37/s fell to ~22/s by 90,000 ledger rows). Postgres's slow-query log: `UPDATE merchant_balances` waiting ~0.5 s, `COMMIT` 57 ms. The ledger's balance check (0007, a deferred trigger) sums each entry group at commit with **no index on `entry_group_id`**, so every capture's commit read the whole ledger four times, while holding the merchant's balance-row lock, which every capture for that merchant needs. The discount adjustment also scanned the ledger by `transaction_id`, unindexed. | `db/migrations/0007_ledger_double_entry.sql`, `apps/api/src/payments/discountAdjustment.ts` | Migration `0083`: indexes on `ledger_entries(entry_group_id)` and `(transaction_id)`. | ~37/s at 90,000 ledger rows; slow statements went from thousands to dozens |
| 3 | The merchant balance cache (audit 07 on main) was updated mid-transaction, so the row stayed locked through the rest of checkout: one merchant's checkouts queued on it. | `apps/api/src/payments/balanceCache.ts` | Changes are added up and written as the transaction's last statement, before COMMIT (`withTransaction`'s new `onBeforeCommit`). Same transaction, same total; the lock covers one statement and the commit. Outside a `withTransaction`, written at once as before. Audit 07's own check still passes. | shorter lock; tested in `balanceCache.test.ts` |
| 4 | The reporting worker ran a pass on every outbox NOTIFY, back to back under load; each pass compares the outbox with the processed-events table (audit 10 on main), a cost that grows with the outbox: ~22 % of the core. | `apps/reporting/src/consumer/listener.ts` | At most one pass every 500 ms (`REPORTING_MIN_PASS_GAP_MS`); events arriving in between are taken together by the next pass. Dashboards update at most half a second later. | core back for checkout |

## Past the limit: turning the excess away

Without protection the API accepted everything: checkout slowed for
everyone at once and then failed. Now `apps/api/src/plugins/overloadGuard.ts`
answers `503 {"error":"overloaded"}` with `Retry-After: 1` the moment it is
full, before reading the body or touching the database, so what it does let
in stays fast:

- **Full** means 32 requests in flight (`OVERLOAD_MAX_IN_FLIGHT`), or, for
  anything but paying, requests queueing for a database connection
  (`OVERLOAD_MAX_POOL_WAITING`, 10) or the event loop stalled for 2 s
  (`OVERLOAD_MAX_EVENT_LOOP_DELAY_MS`).
- **Paying comes first**: a pay request may use all 32 slots, everything
  else 24, so a buyer who already has the page finishes before new page
  loads are let in.
- **Never shed**: `/healthz`, `/readyz` and CORS preflights, so a busy API
  is never mistaken for a dead one.
- **Cheap to refuse**: refused requests are not logged one by one (that cost
  more CPU than the refusal); `/healthz` reports `load.inFlight` and
  `load.shedTotal` instead. Real requests log one "request completed" line.
- **The checkout page** says "We're very busy right now. No payment was
  taken. Try again in a few seconds." on a refused payment, and on a refused
  page load waits and retries (1, 2, 4, then every 5 s) instead of saying
  the link doesn't exist.

The 32 was measured: 48 let more in but made everyone slower; 40 made the
waiting buyers wait longer (buyer p95 2.7 s against 0.9 s).

Two things learned on the way, both in the code's comments:

- Refusing payments on event-loop lag as well made throughput collapse
  under a flood: answering the flood kept the CPU busy, the lag stayed
  high, and every payment was refused. Payments are refused only by the
  in-flight limit.
- A client that retries a refused request instantly is the worst case. Hammered
  that way (200 buyers, **137,472 refusals in 30 s**, ~4,600 a second), the
  API still completed **35.7 checkouts/s** at p95 1.16 s with no errors, and
  the step after it (20 buyers) was back to p95 0.75 s straight away.

## Restarting itself, without losing data

| Failure | What happens now |
|---|---|
| API process crashes or is killed | `restart: unless-stopped` (compose) starts it again. Measured: answering again **2.2-2.5 s** after `kill -9`, under 4x capacity. |
| API freezes (event loop stuck) | Docker only restarts a process that exits. `apps/api/src/lib/watchdog.ts`: a worker thread watches a heartbeat from the main thread; 30 s without one (`WATCHDOG_STALL_MS`) and it kills the process, which is then restarted. Tested: a blocked process killed within 3 s of a 3 s limit. |
| Postgres crashes | `restart: unless-stopped` on postgres. The API no longer dies with it: a connection lost while checked out (a checkout waiting on the acquirer inside its transaction) used to emit an unhandled `error` and **exit the whole API** (found by this test). Every pool connection now has a listener: that transaction rolls back and the API stays up and reconnects. Measured: API up throughout; checkouts resumed as soon as Postgres accepted connections. |
| API memory leak | `mem_limit: 768m` with node's heap capped at 512 MB: a leak ends in a crash and a restart, not a swapping box. |
| `docker compose stop` / redeploy | `init: true` delivers SIGTERM to node; in-flight checkouts get to finish (25 s grace); a shutdown that hangs exits after 20 s. |

**Why no data is lost.** Every payment commits in one Postgres transaction
(capture, ledger, balance cache, outbox event, link marked paid) before the
`200` is sent, and commits are durable (`fsync` and `synchronous_commit` on,
the defaults). A crash can only cut off requests still in flight: their
transactions roll back. A link whose payment was cut off between authorize
and capture stays `reserved` and is free again after the 60 s reservation
timeout; it was never charged.

**Crash test, measured.** 120 buyers (about 4x capacity) for 75 s; the API
killed with `kill -9` at 15 s; Postgres killed with `kill -9` at 35 s and
restarted 3 s later, as Docker would. Buyers retried like the checkout page
does, with a fresh idempotency key each time, so a payment whose answer was
lost could have been charged twice. Results:

- 2,262 paid; 181 checkouts hit a failure and went through on a retry;
  20 were still waiting at the end on a link held by a cut-off attempt
  (not charged, freed by the timeout).
- `verify-db.mjs`: ledger balances; every paid link has exactly one full
  capture; **no buyer charged whose link isn't paid; no double charges**;
  every capture has its event and outbox row; the balance cache moved
  exactly as the ledger did.
- The load script checked every one of the 2,398 answers against the server:
  every "paid" is paid with its captured transaction; nothing turned away
  or failed was charged.

## Running it on the live server

On the box, after deploying (`git pull`, then
`docker compose -f ops/docker-compose.yml up -d --build`, which runs
migrate, including `0083`):

`verify-db.mjs` needs Node 22 and the database. If the box has no Node
outside Docker, run it in the migrate image, which has both (it connects as
the owner, like migrate):
`docker compose -f ops/docker-compose.yml run --rm -v "$PWD/scripts/out:/app/scripts/out" migrate node scripts/load/verify-db.mjs --baseline`

```sh
# 1. Before: remember the balance cache's state.
DATABASE_URL=postgres://filspay:...@127.0.0.1:5432/filspay node scripts/load/verify-db.mjs --baseline

# 2. Load (from another machine if possible, so it doesn't share the vCPU).
#    A staging merchant's API key; it creates real links and payments.
API_URL=https://<api host> API_KEY=<key> MERCHANT_ID=<id> \
  STEPS=10,20,30,40,60,100 STEP_SECONDS=30 node scripts/load/checkout-load.mjs

# 3. Overload and recovery: during a long step, kill things.
API_URL=... API_KEY=... MERCHANT_ID=... STEPS=120 STEP_SECONDS=90 node scripts/load/checkout-load.mjs &
sleep 20; docker compose -f ops/docker-compose.yml kill -s KILL api
sleep 20; docker compose -f ops/docker-compose.yml kill -s KILL postgres
wait

# 4. After: the database checks.
DATABASE_URL=... node scripts/load/verify-db.mjs <time the test started, ISO>
```

The load script prints a line per step and the capacity (the largest step
that was fast and correct: p95 within `P95_MS`, default 1,500 ms, no
errors, nobody asked to wait) and writes a JSON report to `scripts/out/`.
`RETRY=immediate` makes it retry refusals instantly, the harshest client.
`docker ps` shows the restarts; `/healthz` shows `load.shedTotal`.

## Settings

| Variable | Default | |
|---|---|---|
| `PG_POOL_MAX` | 20 (was 5) | API database connections |
| `OVERLOAD_MAX_IN_FLIGHT` | 32 | requests in flight before refusing; 0 turns shedding off |
| `OVERLOAD_MAX_POOL_WAITING` | 10 | non-payment requests refused while this many wait for a connection |
| `OVERLOAD_MAX_EVENT_LOOP_DELAY_MS` | 2000 | non-payment requests refused while the event loop lags this much |
| `WATCHDOG_STALL_MS` | 30000 | a frozen API is killed (and restarted) after this; 0 turns it off |
| `REPORTING_MIN_PASS_GAP_MS` | 500 | least time between reporting consumer passes |

On a bigger box, raise `OVERLOAD_MAX_IN_FLIGHT` with the cores (it is about
throughput x 0.85 s) and re-run the script.

## Not covered

- The organisers' exact scenario: if it differs (think time, more than one
  merchant, a different card mix), throughput per core stays about the same;
  the user counts above scale with think time as described.
- Webhook delivery under load (the dispatcher ran, but no endpoints were
  registered for the test merchant).
- Settlement's batch close during peak checkout.
