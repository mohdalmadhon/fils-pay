# AI in the capacity work

Branch `capacity`, 30 October 2026. Results:
[`docs/perf/checkout-capacity.md`](../../docs/perf/checkout-capacity.md).
Annotated transcript: [`docs/SUBMISSION.md`, excerpts 2 and 3](../../docs/SUBMISSION.md#excerpt-2-capacity-measured-rather-than-guessed).

## What I asked

"we load test on your live server with fixed checkout scenario and measure
how many users it serves while staying fast and correct. send us your
estimate because an accurate one earns point. then we push past your limit
and see wether your stack turns away the exceses restart itself and
recovers without losing data. do this"

## How the assistant worked

- **Asked for the one fact that sets the answer**: the server's hardware.
  The repo said 0.5 vCPU; it is 1 vCPU. Then it reproduced that box: Postgres,
  the API and the reporting worker pinned to one core, the load generator on
  another.
- **Measured the code as it was first** (10 checkouts a second, then 500
  errors), and checked every payment against the server during every run,
  so speed was never bought with correctness.
- **Let measurements pick the fixes**: the connection pool, then Postgres's
  slow-query log, a disk test and the list of triggers, which found an
  unindexed lookup at every commit. Result: about 38 checkouts a second on
  one vCPU, p95 under 1 s.
- **Built the overload and crash behaviour and tested it by breaking
  things**: floods of up to 320 buyers, clients that retry instantly,
  `kill -9` of the API and of Postgres mid-load, then database checks that
  nothing was lost or doubled.
- **Left a way to check it on the real server**: the scripts in
  `scripts/load/` and the steps in the write-up.

## Tools and checks

| | |
|---|---|
| Load | `scripts/load/checkout-load.mjs` (written for this): steps of buyers, latency, outcomes, then every answer checked against the server |
| Database checks | `scripts/load/verify-db.mjs`: ledger balanced, one capture per paid link, no stray or double charges, cache moved with the ledger |
| Diagnosis | Postgres `log_min_duration_statement`, `pg_test_fsync`, `pg_trigger`, `pg_indexes`; the API's own `/healthz` load counters |
| Crash test | a restart loop standing in for Docker's restart policy, a probe every 250 ms, `kill -9` |
| Regression | the full test suite (548 API tests), builds, the browser check |

## What it got wrong, and how that was caught

- Took a drop in throughput for the new guard misbehaving, changed the
  guard twice and wrote that explanation into a code comment and the doc.
  The guard's counters showed the real cause: its own load script had run
  out of payment links. Corrected, and the write-up has a "Corrections"
  section (excerpt 3 in the submission).
- Ran one comparison against a stale API process still holding the port,
  and stopped its own shell more than once with `pkill -f`; both led to
  checks that the right process is running, and process control in script
  files.
- Its first fix for the slowdown (a shorter lock) was not enough; the next
  measurement said so, which led to the real cause.
