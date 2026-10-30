# Local load and crash test (2026-10-30)

| | |
|---|---|
| **Question** | What is the most the server can take, when does it start to slow down, how does it cope past that, and does a crash lose data? |
| **Code** | `main` after the bug sweep (`docs/bugs/`), the tour and Edit layout, and the teammate's capacity work: everything that is on `main` today |
| **Setup** | The API (development mode, as on a laptop), Postgres and the reporting worker sharing **one core** of an Intel Xeon @ 2.10 GHz, the size of the hosted box. The load generator ran on a second core so it didn't take CPU from the server. Seeded database, simulated acquirer at its defaults (100–400 ms per call, two calls per checkout, ~2 % declines). |
| **Graphs** | [`2026-10-30-local-load-test/report.html`](2026-10-30-local-load-test/report.html), one page that opens offline |
| **Raw data and logs** | [`2026-10-30-local-load-test/`](2026-10-30-local-load-test/) |

## The answers

| | Result |
|---|---|
| **Maximum capacity** | **About 37 checkouts a second** (≈2,200 a minute), with p95 under 0.9 s. It stays at that from 20 buyers up to 200. |
| **Fast with no waiting** | Up to **20 buyers** checking out back to back: p95 0.75 s, nobody turned away, no errors. |
| **When it starts to slow down** | From **40 buyers**. The server itself doesn't slow down: every checkout it lets in still takes p95 0.85–0.89 s. Instead it turns the excess away at once with `503` and `Retry-After: 1`. The buyer's total time, including waiting to retry, goes past 1.5 s from about 120 buyers (6.8 s at p95) and reaches ~15 s at 160–200 buyers. |
| **How it copes** | Throughput holds flat at ~37/s from 20 to 200 buyers, and there are no errors at any step. A buyer who is turned away is never charged, and gets in when they retry. At 200 buyers, 5,280 requests were asked to wait. |
| **API process crash** (`kill -9` mid-payment) | Answering again **2.4 s** later, capturing payments again after **2.1 s**, then back to the same ~35/s. |
| **Database crash** (`kill -9` of Postgres) | During the ~5 s outage the API answered 500 (660 requests, every one a "can't reach the database" error). Payments flowed again within **0.4 s** of Postgres accepting connections, with no manual step. The reporting worker retried, then caught up to the last event. |
| **Data lost?** | **None.** The database checks after both parts all pass: the ledger balances, every paid link has exactly one full capture, no buyer was charged without the link being marked paid, no double charges, every capture has its event and outbox row, and the balance cache moved with the ledger. Crash test: 2,911 paid, all accounted for. |

## Reading the graphs (`report.html`)

1. **Capacity tiles and "Throughput"**: checkouts finished per second
   against the number of buyers. It climbs in a straight line to 20 buyers
   (one core's worth), then stays flat. Flat is the good outcome: more
   buyers don't make it slower or break it.
2. **"How long a checkout takes"**: p50, p95 and p99 stay between 0.5 and
   0.96 s at every step. The dashed line is what the buyer feels, including
   time spent waiting to retry after a 503. That is where overload shows,
   from ~120 buyers.
3. **"What happened to each checkout"**: in every step, nearly all are
   paid, with ~4 % simulated declines and **no errors**. The orange part is
   buyers still waiting to retry when the 30 s step ended.
4. **"The ramp, second by second"**:
   - Payments captured per second, counted in the database.
   - Requests in flight: they level off at ~24, the overload guard's limit.
   - Event-loop delay: usually ~11 ms, with brief spikes to 112 ms.
   - The running total of 503s, which starts rising at 40 buyers.
   - API memory: 107 to 197 MB, with no growth that looks like a leak.

   The short drops to zero between steps are the load tool preparing the
   next step's payment links. That time isn't counted in the step's
   numbers.
5. **"Crash test"**: the same graphs with the kills marked. The shaded
   strips show when the API wasn't answering (~2 s) and when the database
   was down (~8 s from the kill to "accepting connections").

## What the logs show

`2026-10-30-local-load-test/api-log-summary.txt` summarises the 12 MB API
log:

- **Ramp:** only 200, 201, 402 (simulated declines) and 502 (the simulated
  acquirer's injected outages). No 500s.
- **Crash:**
  - The API process started twice: once at the start, and once after the
    kill. Nothing else restarted it.
  - All 660 500s fall inside the 5.5 seconds the database was down. They are
    connection refused, or "the database system is starting up".
  - The 409 `payment_link_processing` answers are buyers whose link was held
    by a checkout that died with the API process. Such a link is held until
    its 60 s reservation timeout, then the next buyer can take it over.
    21 links were still held when the test ended. None was charged.

`events.log` lists every step and kill with its time. `ramp.out` and
`crash.out` are the load tool's own output.

## Things this test found

These are not changed here, because the load and capacity code belongs to
another person's work. They are noted for them:

1. **While the database is down the API answers 500, not 503.** A 503 with
   `Retry-After` would tell the checkout page and API clients to retry.
   Nobody was charged either way.
2. **A checkout that dies with the API process holds its link for 60 s.**
   The buyer's retry gets `409 payment_link_processing` until the
   reservation times out. A shorter timeout, or releasing reservations on
   startup, would shorten that wait. No money is at risk: the reservation
   token stops a second charge.

## Running it on your own machine (Windows, PowerShell)

Start the database and API as in the setup steps. You need the API window
with `OTP_DEV_EXPOSE=true`. Then open two more PowerShell windows in the repo
folder.

**Window A**, the timeline (leave it running):

```powershell
$env:OUT = "scripts/out/run/ramp-health.csv"
node scripts/load/sample-health.mjs
```

**Window B**, the load (about 6 minutes; it creates real test payments in
your local database):

```powershell
$env:DATABASE_URL = "postgres://filspay:devpass@localhost:5432/filspay"
node scripts/load/verify-db.mjs --baseline
$start = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$env:STEPS = "5,10,20,40,60,80,120,160,200"; $env:STEP_SECONDS = "30"
$env:REPORT = "scripts/out/run/ramp.json"
node scripts/load/checkout-load.mjs
```

When it finishes, press Ctrl+C in window A, then in window B:

```powershell
node scripts/load/verify-db.mjs $start | Tee-Object scripts/out/run/ramp-verify.out
node scripts/load/export-throughput.mjs $start | Set-Content scripts/out/run/ramp-tps.csv -Encoding ascii
node scripts/load/report-html.mjs scripts/out/run
start scripts/out/run/report.html
```

**Crash test on Windows:**

1. Run window A again with `$env:OUT = "scripts/out/run/crash-health.csv"`.
2. In window B, run the load with `$env:STEPS = "120"`,
   `$env:STEP_SECONDS = "90"` and
   `$env:REPORT = "scripts/out/run/crash.json"`.
3. About 20 s in, kill the API from a third window:
   `Get-Process node | Stop-Process -Force`. This also stops the
   dashboard's dev server.
4. Start the API again in its window with `npm.cmd run dev`.
5. For the database, run `docker kill <postgres container>`, then
   `docker compose -f ops/docker-compose.yml up -d postgres`.
6. Afterwards, run the same `verify-db`, `export-throughput` and
   `report-html` commands with `crash-` file names. Note the kill times in
   `scripts/out/run/events.log` (`2026-10-30T19:11:11Z kill -9 api`, one per
   line) to have them marked on the graphs.

A laptop has more and faster cores than the hosted box, so expect higher
numbers there. The shape should be the same: a flat line at the top, with
the excess turned away rather than errors.

## How this run was made

`/var/tmp/loadrun.sh`, not committed:

- the API runs under a restart loop, the way Docker's
  `restart: unless-stopped` works;
- `verify-db.mjs --baseline` runs before each part;
- `checkout-load.mjs` runs on a separate core;
- `sample-health.mjs` runs once a second (twice a second during the crash
  test), and `ps` records the API's memory;
- the database checks run after each part, and
  `export-throughput.mjs` and `report-html.mjs` produce the page.

The scripts are in `scripts/load/`. The earlier, longer study of what
limited capacity and how it was fixed is
[`checkout-capacity.md`](checkout-capacity.md).
