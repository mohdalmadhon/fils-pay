# FilsPay: submission

Team member: **malmadhoo** (Mohammed Almadhoon). Branch history is on
`main`; each piece of work has its own write-up, listed below.

## What was done

| Area | Write-up |
|---|---|
| Security review and fixes | [`docs/cyper/`](cyper/) |
| Fixes and improvements 01-19 (tests, CI, Dockerfiles, refunds, signup limits, service roles, migration checksums, browser and accessibility checks, …) | [`docs/improvements/`](improvements/) |
| Redesign: three designs in light and dark, layouts, Halloween costume | [`docs/design/README.md`](design/README.md) |
| Merging the team's audit fixes (`main`) into the redesign | [`docs/merges/2026-10-30-main-into-ui-ux.md`](merges/2026-10-30-main-into-ui-ux.md) |
| Checkout capacity, overload and crash recovery | [`docs/perf/checkout-capacity.md`](perf/checkout-capacity.md) |
| AI setup | [`ai-setup/`](../ai-setup/README.md) |

## AI usage and setup

**Setup.** Claude (Anthropic, Claude Opus 5.5) in the Claude app, working in
a cloud workspace with Node, Go, Postgres and a headless browser, linked to
my laptop through the Claude desktop app. It does the work and the testing
in the workspace, commits under my name, and hands the commits to my laptop
as git bundles; I review and push. Everything about the setup (standing
instructions, helper scripts, how a task runs) is in
[`ai-setup/`](../ai-setup/README.md).

**How I used it.** I gave the goal and the rules ("do not push", "I need to
be the commiter", "every issue I need 5 commits", "document everything and
where u found the issue and what was the fix"), answered its questions
where the choice was mine (which branch, what hardware the server has,
which colours), and corrected it when it went the wrong way ("continue but
do not use purple"). It was expected to prove every claim with a test, a
measurement or a log, and the write-ups record that evidence.

The three excerpts below are from the session transcript, word for word.
`[…]` marks a cut; times are Bahrain time on 30 October 2026. Each one is
followed by notes on what it shows.

---

### Excerpt 1: a merge conflict that wasn't only text

I had started merging the team's audit fixes from `main` into the redesign
branch and hit conflicts.

> **Me (16:05):** I tried to merch it from main. check and fix the merge
>
> **Claude:** Checking the merge state on your machine.
>
> ```
> On branch UI/UX
> You have unmerged paths.
> […]
> ```
>
> **Claude:** Four files have conflicts. The many other modified files may
> just be line-ending noise, so I'm checking that first:
>
> ```
> UU CHANGELOG.md
> UU apps/api/src/payments/discountAdjustment.ts
> UU apps/settlement/internal/settlement/fee_schedule.go
> UU apps/settlement/internal/settlement/platform_volume.go
> ```
>
> **Claude:** With line endings normalised, only the four conflicted files
> differ; the rest is noise. […]
>
> ```
> fee_schedule.go: 41: <<<<<<< HEAD
> fee_schedule.go: 42:   ORDER BY effective_from ASC, created_at ASC, id ASC
> fee_schedule.go: 43: =======
> fee_schedule.go: 44:   ORDER BY effective_from ASC, created_at ASC
> fee_schedule.go: 45: >>>>>>> 9571805…
> ```
>
> *(Claude searched the API for the same query:)*
>
> ```
> apps/api/src/fees/feeSchedule.ts:31:  ORDER BY effective_from DESC, created_at DESC, id DESC
> ```
>
> **Claude:** The API breaks ties by `id` as well, so this branch's Go
> ordering is the one that matches.
>
> […]
>
> *(After reading the auto-merged `pay.ts` and both versions of
> `capture.ts`, Claude resolved `discountAdjustment.ts` with this comment in
> the code:)*
>
> ```ts
> // capture.ts already posts the discounted fee, the way settlement computes
> // it (settlementFeeFils; docs/improvements/06), and records the pricing
> // snapshot (chargedMdrBps, negotiatedDiscountBps; audit 09 on main). For a
> // capture with that snapshot the adjustment below therefore comes to 0:
> // it only marks the event as adjusted (negotiatedDiscountAppliedFils = 0),
> // so a capture is never discounted twice.
> ```
>
> […]
>
> **Claude:** It passes. But that test may not touch main's new
> `reporting_processed_events` table, so I'm checking the per-service grants
> cover it directly: […]
>
> **Claude:** Only the reporting role is missing access; the API and
> settlement grants already cover main's other changes. […] Adding that to
> the role script, plus a check in the roles test so a gap like this fails
> the build next time:
>
> ```
>   error: 'permission denied for table reporting_processed_events'
> # pass 0
> # fail 1
> # pass 1
> # fail 0
> ```
>
> **Claude:** The roles test now fails without the grant ("permission
> denied for table reporting_processed_events") and passes with it.

**Notes**

- **It checked before trusting the diff.** A long list of files showed as
  modified on my laptop; it confirmed they were only Windows line endings
  before touching anything.
- **Conflicts were settled by evidence, not by picking a side.** For the fee
  schedule it looked at what the API does and kept the version that matches
  it.
- **The risky part had no conflict markers.** `main` and my branch had each
  fixed the negotiated discount in a different way, and `pay.ts` merged
  "cleanly" with both in place: exactly where a double discount would hide.
  It read the code around the conflict and worked out that the two fit (with
  the snapshot capture now records, the second step comes to 0), wrote down
  why in the code, and strengthened a test so it would fail if a checkout
  were ever discounted twice.
- **A bug git could not see.** `main` added a table that my branch's
  least-privilege database roles didn't cover; reporting would have failed
  in production. It showed the test failing without the fix ("permission
  denied") and passing with it, so the test now guards it.
- Write-up: [`docs/merges/2026-10-30-main-into-ui-ux.md`](merges/2026-10-30-main-into-ui-ux.md).

---

### Excerpt 2: capacity, measured rather than guessed

The organisers load-test the live server and score an accurate capacity
estimate.

> **Me (16:23):** work on this
> capacity:
> we load test on your live server with fixed checkout scenario and measure
> how many users it serves while staying fast and correct. send us your
> estimate because an accurate one earns point. then we push past your
> limit and see wether your stack turns away the exceses restart itself and
> recovers without losing data. do this
>
> **Claude:** The repo documents the hosted API as running in a container
> with half a CPU core and 512 MB. That limit drives the capacity number, so
> I need to confirm it before measuring:
>
> *(My answers: "1 vCPU / 1–2 GB"; measure "Locally + script".)*
>
> **Claude:** Thanks. One vCPU most likely means the whole stack (Postgres,
> API, settlement, reporting) shares that one core, so I'll measure with
> everything pinned to a single core here. […]
>
> **Claude:** Baseline run of the current code before changing anything:
>
> ```
>    5 buyers    9.4/s  p50 536 p95 730 p99 801 ms   […]
>   20 buyers   10.3/s  p50 2046 p95 2355 p99 2593 ms […]
>  160 buyers   14.6/s  p50 11530 p95 13415 p99 13648 ms  paid 285 declined 6 shed 0 errors 156  […]
> verified: every paid link has its captured transaction; nothing turned away or failed was charged
> ```
>
> […] *(Raising the connection pool from 5 to 20 took it to ~37/s, but as
> the test database grew, throughput fell again.)*
>
> **Claude:** That code adds incrementally, so it isn't a scan. Rather than
> guess, I'll have Postgres log every statement slower than 20 ms during a
> short run:
>
> ```
>   30 buyers   20.3/s  p50 1540 p95 2177 […]
>    288   140010 ms   UPDATE merchant_balances SET cached_payable_fils = cached_payable_fils + $2, updated_at =
>    215     6330 ms   COMMIT
> ```
>
> *(Claude moved that update to the end of the transaction and measured
> again. It was not enough:)*
>
> ```
>   40 buyers   22.1/s  p50 1880 p95 2496 […]
>   1905   800040 ms   UPDATE merchant_balances SET cached_payable_fils = cached_payable_fil
>   2006   114314 ms   COMMIT
>    896    29116 ms   SELECT 1 FROM ledger_entries WHERE transaction_id = $1
> ```
>
> *(It then tested the disk and listed indexes and triggers:)*
>
> ```
>         fdatasync                          3157.431 ops/sec     317 usecs/op
> […]
> CREATE INDEX idx_ledger_entries_merchant_occurred ON public.ledger_entries USING btree (merchant_id, occurred_at)
> 87622
> […]
> ledger_entries|ledger_entries_balance|t|t|check_ledger_group_balance
> ```
>
> *(The balance check runs at every commit and sums an entry group by
> `entry_group_id`, which had no index. After migration 0083 added it:)*
>
> ```
>   20 buyers   33.1/s  p50 616 p95 848 p99 944 ms […] errors 0  OK
>   40 buyers   36.9/s  p50 1116 p95 1365 p99 1444 ms […] errors 0  OK
>    714    22331 ms   SELECT id, event_type, aggregate_id, payload, created_at
>     61     1982 ms   UPDATE merchant_balances SET cached_payable_fils = cached_payable_fil
> ```

**Notes**

- **It asked the one question that changed the answer.** The repo said
  0.5 vCPU; the server has 1. An estimate on the wrong hardware would have
  been wrong by about half.
- **It measured before changing anything,** and checked correctness at the
  same time as speed: the baseline already verified every payment against
  the server.
- **Its first fix didn't solve it, and the measurement said so.** Moving
  the update helped little; it didn't stop there. It ruled out the disk
  (0.3 ms per flush), then found the real cause by listing the database's
  triggers: an unindexed lookup at every commit, there since the first
  migrations, that gets slower with every payment.
- **The next bottleneck showed up in the same output** (the reporting
  worker's query), and was handled the same way.
- Result: about 38 checkouts a second on one vCPU at p95 under 1 s, up from
  10; overload refused with `503` and `Retry-After`; restarts and a crash
  test with no payment lost or doubled. Write-up:
  [`docs/perf/checkout-capacity.md`](perf/checkout-capacity.md).

---

### Excerpt 3: where the AI was wrong

While adding load shedding, a run looked as if the new guard made things
far worse.

> ```
>   30 buyers     28/s  p50 1093 p95 1423 p99 1614 ms  paid 539 declined 21 shed 0 errors 0  OK
>   40 buyers      3/s  p50 1469 p95 2049 p99 2184 ms  paid 60 declined 1 shed 1939 errors 0  OVER
>  320 buyers    4.2/s  p50 2079 p95 3558 p99 4258 ms  paid 80 declined 3 shed 15917 errors 0  OVER
> ```
>
> *(Claude took this as the guard over-shedding, changed it, and wrote its
> explanation into a code comment:)*
>
> ```ts
>  * new page loads are let in. (Shedding pays on lag too made throughput
>  * collapse under a flood: answering the flood's 503s kept the CPU busy,
>  * the lag stayed high, and every payment was refused.)
> ```
>
> *(The next run still showed the drop, now from 30 buyers:)*
>
> ```
>   20 buyers   23.6/s  p50 824 p95 1323 […] shed 0 errors 0  OK
>   30 buyers    2.3/s  p50 1077 p95 1981 […] shed 1454 errors 0  OVER
> ```
>
> *(It made one more change to the guard, saw the same, and then watched the
> guard's own counters every second during a run:)*
>
> ```
> "load":{"inFlight":5,"shedTotal":0,"eventLoopDelayMs":20}}
> "load":{"inFlight":26,"shedTotal":390,"eventLoopDelayMs":12}}
> "load":{"inFlight":0,"shedTotal":1094,"eventLoopDelayMs":11}}
> "load":{"inFlight":0,"shedTotal":1094,"eventLoopDelayMs":10}}
> […]
>   30 buyers    2.1/s  p50 1240 p95 2047 p99 2095 ms  paid 29 declined 2 shed 1094 errors 0  OVER
> ```
>
> *(Requests in flight fell to 0 within about five seconds of a 15-second step: the
> load script was moving to a new payment link after every 503 and had used
> them all up. Once the script retried the same link, as a buyer does:)*
>
> ```
>   20 buyers   23.1/s […] 503s 0 (0 buyers waited) errors 0  OK
>   80 buyers   23.4/s […] 503s 1120 (73 buyers waited) errors 0  OVER
>  320 buyers   23.4/s […] 503s 5920 (383 buyers waited) errors 0  OVER
> verified: every paid link has its captured transaction; nothing turned away or failed was charged
> ```

**Notes**

- **The confident explanation was wrong.** The "collapse" was a bug in the
  AI's own test tool, not in the server. The counters, not the explanation,
  showed it: nothing was in flight, so nothing was being protected.
- **The wrong story had already reached the code.** The comment above was
  committed, along with a doc sentence saying the same and a claim that a
  limit of 48 "made everyone slower" (that run had gone to an old API
  process still holding the port). All three were found while preparing
  this document, by checking each claim against the transcript, and were
  corrected; the capacity write-up now has a
  [Corrections](perf/checkout-capacity.md#corrections) section saying what
  was wrong and why.
- **Smaller slips, same lesson.** It stopped its own shell at least three times by
  running `pkill -f` with a pattern that matched its own command line, and
  once ran a test against a stale API process. Each time the next result
  looked wrong, it checked, and then changed how it worked (process control
  moved into script files; a check that the new API really started).
- This is the repo's own warning (`docs/the-order-of-the-prompt.md`): "The
  model knows" is the first rule of the fictional Order. Here the model was
  wrong more than once; the work held up because every claim had to survive
  a measurement or a test, and the ones that didn't were taken back.
