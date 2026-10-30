# Hosted box capacity — 2026-10-30

## Result

On the hosted box (`159.89.173.8`, 1 vCPU / 2 GiB, API container at
`--cpus 0.5 --memory 512m`), checkout for **one merchant** tops out at about
**22 checkouts/s**. Every checkout in every run passed the load script's
server-side verification (each paid link has its captured transaction;
nothing refused or declined was charged).

| API pool / in-flight | Buyers | Checkouts/s | Buyer p95 |
|---|---:|---:|---:|
| 20 / 32 (current) | 10 | 9.7 | 1.27 s |
| 20 / 32 | 30 | 22.0 | 2.28 s |
| 20 / 32 | 60 | 22.6 | 7.0 s (503 retries) |
| 40 / 64 | 60 | 25.8 | 4.0 s |

Buyer times include ~136 ms RTT per request through an SSH tunnel from the
load generator. Server-side, a pay request averaged ~990 ms against ~500 ms
on a local machine.

**Do not raise `PG_POOL_MAX` on the box.** Pool 40 gave the same
throughput with p95 roughly doubled. CPU was 40-60 % idle during the steady
part of each step, and the API container was throttled in 21 of 1,298
periods (0.76 s in total), so neither CPU nor the 0.5-vCPU quota is the
limit.

Not confirmed (measurement stopped before the wait-event sample): the
likely serial section is the merchant's `merchant_balances` row, which each
capture locks until its COMMIT, including the commit's WAL flush on the
box's disk. If so, ~22/s is a per-merchant limit and traffic spread over
several merchants goes further. A multi-merchant run and a
`pg_stat_activity` wait-event sample during a step would settle it.

## Fix: migration 0089

`pg_stat_statements` on a local run (20 buyers, ~18,000 prior payments)
showed every checkout reading two tables in full:

| Statement | Mean before | Table scans after one run |
|---|---:|---|
| `UPDATE outbox_events ... WHERE aggregate_id = $1 AND event_type = $4` (pay.ts) | 1.57 ms | outbox_events: 27,455 seq, 0 index |
| capture's lock SELECT (`max(h.expires_at) FROM holds h WHERE h.transaction_id = t.id`) | 0.96 ms | holds: 36,091 seq, 0 index |
| `UPDATE holds ... WHERE transaction_id = $1` (capture.ts, void.ts) | 0.94 ms | |

[0089](../../db/migrations/0089_checkout_hold_outbox_indexes.sql) adds
`holds(transaction_id)` and `outbox_events(aggregate_id, event_type)`.
Afterwards none of the three appears in the top statements, and total
statement time per checkout fell about 3.5x. Throughput locally was
unchanged (~38/s, pool-bound). On the box it was also unchanged, since its
tables are still small. Without the indexes, these scans grow with every
payment, inside the capture transaction, while it holds locks.

## How it was run

A throwaway `filspay_loadtest` database in the box's Postgres container,
migrated and seeded with the deployed image (`filspay-node:0b2eefd`),
plus temporary API and reporting containers on the compose network with
the production limits, `NODE_ENV=production`, and the simulator at its
defaults. `scripts/load/checkout-load.mjs` was driven through
`ssh -L 3901:127.0.0.1:3901`. The demo database was not touched. The test
containers and database were removed afterwards.
