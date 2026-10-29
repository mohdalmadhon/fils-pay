# Fix report: duplicate payout notifications (incident 2026-08-21)

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. Shops got two "your payout is on the way" (`settlement.paid`) webhooks for one payout, and each affected batch got **two disbursement records**, the operational record of a payout-rail instruction. |
| **Components** | `apps/settlement/internal/settlement/payout_notify.go`, `apps/api/src/webhooks/payoutDisbursement.ts`, `apps/api/src/webhooks/dispatcher.ts`, `db/migrations/0075` |
| **Reported** | Shops got two payout messages for the same payout. Two processes checked at the same time and both thought they were first. |
| **Date** | 2026-10-29 |

## Summary

After a batch is paid, `EnqueuePayoutNotifications` (Go settlement service)
enqueues one `settlement.paid` outbox event per paid batch. It worked in two
separate steps with nothing tying them together:

1. **Check:** `SELECT ... WHERE status = 'paid' AND NOT EXISTS (settlement.paid event for this batch)`
2. **Insert:** a plain `INSERT INTO outbox_events (...)` for each batch found.

The function runs from the daemon's tick (`scheduler/daemon.go`) **and** from
the `run-batch` CLI (`cmd/settlement/main.go`). On 2026-08-21 both ran at
the same moment. Both did step 1 before either did step 2, so both saw
"no event yet" for the 20 Aug batches, and **both inserted**. That gave two
outbox rows with two different ids. The webhook dispatcher correctly
created one delivery per outbox row, so each shop got two webhooks.

The duplicate then reached money records too. Before the first attempt of
every `settlement.paid` delivery, the dispatcher calls
`recordPayoutDisbursementEffect`, which inserted a disbursement row with no
uniqueness. So it ran once per duplicate event. It also ran once per merchant
endpoint and again on every replay, even with no duplicate event at all.

## Where it was found

- `apps/settlement/internal/settlement/payout_notify.go`
  - The doc comment said "Idempotent by construction: the NOT EXISTS guard…".
    That only holds for runs one after another; it is a read with no lock.
  - FH asked in August whether daemon + `run-batch` at the same time would both
    pass NOT EXISTS. The answer next to it, *"No, outbox_events has a unique
    index on (event_type, aggregate_id)"*, is false: `0009_outbox_events.sql`
    has only a primary key and an `idx_outbox_unprocessed` index. MK: *"daemon
    and CLI never overlap"*. They did.
  - `payout_notify_test.go`: *"FH: sequential re-run only, concurrent run not
    covered. todo"*.
- `db/migrations/0057`: *"one row per paid batch"* for
  `settlement_payout_disbursements`, with no constraint behind it.
  `payoutDisbursement.test.ts`: *"FH: only checks the insert, not who calls it
  or how often"*.
- `apps/api/src/webhooks/dispatcher.ts`, `PRE_DELIVERY_EFFECTS["settlement.paid"]`:
  runs per delivery row, not per payout.
- `docs/ADMIN.md`, incident review: root cause recorded as *"reporting worker
  restarted and replayed NOTIFYs"*. That can't produce this, since deliveries
  are unique per (outbox event, endpoint). AM pointed out that *"the two
  deliveries had different outbox event ids"*, which is the signature of two
  outbox rows. MK answered *"retry artefact"* and the review closed.
- `docs/incidents/postmortem-2026-05.md`, action 7: an advisory lock
  `SETTLEMENT_SINGLETON_LOCK` (FP-208) marked **Done**. No such code exists
  anywhere in `apps/settlement`.

## Reproduction

New Go test `payout_notify_concurrency_test.go` creates 40 paid batches,
then starts 6 `EnqueuePayoutNotifications` calls at once. **Before** the fix,
over 3 runs it produced **5–6 `settlement.paid` events for a single batch**.
After: exactly 1 per batch, 5 runs out of 5.

New TS test `payoutNotificationOnce.test.ts`:

| Test | What it checks |
|---|---|
| The database refuses a second live `settlement.paid` for one batch | the new index exists and holds |
| 6 runs enqueue at once | 1 event, 1 webhook, 1 disbursement |
| A duplicate marked superseded | gets no delivery (the old dispatcher delivered it) |
| One payout, two endpoints, then a replay | both endpoints notified, **1** disbursement record (the old code wrote one per delivery: 3) |
| 6 concurrent disbursement effects for one batch | 1 record, and only one call reports it wrote |

Run against the old TS code (with 0075 applied), the last three fail. The
first two depend on the migration itself. Without 0075 nothing stops the
second insert, which is what the Go test shows.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `db: allow one settlement.paid event and one disbursement per batch` | Migration `0075`: partial unique index `uq_outbox_settlement_paid_per_batch` on `outbox_events (aggregate_id) WHERE event_type = 'settlement.paid' AND superseded_by IS NULL`, and `uq_settlement_payout_disbursements_batch` on `settlement_payout_disbursements (settlement_batch_id) WHERE duplicate_of IS NULL`. Existing duplicates are **marked, not deleted** (`superseded_by` / `duplicate_of` point at the earliest row), because deliveries reference the outbox rows and the duplicate disbursements are evidence to reconcile. |
| 2 | `settlement: enqueue settlement.paid with ON CONFLICT DO NOTHING` | The insert targets the new index and does nothing on conflict, so the run that loses the race inserts nothing. The returned count is now rows actually inserted. The false "unique index" comment is replaced with the real guarantee. |
| 3 | `webhooks: record one payout disbursement per batch` | `recordPayoutDisbursementEffect` inserts with `ON CONFLICT DO NOTHING` and returns whether it wrote. The dispatcher's Step A skips superseded events. |
| 4 | `test: replay concurrent payout notification enqueue (2026-08-21)` | The Go and TS tests above. |
| 5 | `docs: duplicate payout notification report and incident correction` | This report, plus a correction under the 2026-08-21 review in `ADMIN.md`. |

Why a database constraint and not a lock: the advisory lock in the May
postmortem only helps if every caller remembers to take it (it was never
written). A unique index holds for every caller: daemon, CLI, internal API,
a second replica, or a manual SQL insert. With `ON CONFLICT DO NOTHING` the
loser waits for the winner's commit and then quietly does nothing, so no
error path is needed.

## Verification

- Go: the new concurrency test passes 5/5 runs (it failed on every run before).
  The existing `payout_notify_test.go` tests pass. The full `go test -p 1 ./...` passes.
  - Without `-p 1`, `ledger` and `internalapi` both rebuild balances in the
    same test database at once, and one can hit a duplicate key. That
    happens with or without this change.
- TS: `payoutNotificationOnce.test.ts` passes 5/5. 3 tests fail against the old
  TS code; the other 2 need the migration. `payoutDisbursement.test.ts` passes.
- `tsc --noEmit` is clean.
- Full `apps/api` suite: **396/397**. The one failure is the dispatcher
  backoff/exhaustion test, which was already failing before this work.
- Migration 0075 ran on a database holding real duplicates. The failing Go
  test had left 723 duplicate events there. All were marked superseded and
  the index was built.

## Deploying

1. Run `npm run migrate` to apply 0075. It marks old duplicates and then builds
   the indexes. Deploy before or together with the new settlement binary,
   because the new `ON CONFLICT` clause needs the index to exist.
2. Restart the settlement daemon and the API.
3. Reconcile the duplicates with the payout rail. Each row listed below is a
   second disbursement instruction for a batch:

   ```sql
   SELECT * FROM settlement_payout_disbursements WHERE duplicate_of IS NOT NULL;
   ```

   Rows already sent can't be un-sent. Superseded outbox events
   (`superseded_by IS NOT NULL`) are kept for the audit trail and get no new
   deliveries.

## Related, not changed here

- The disbursement is still recorded as a side effect of a **webhook delivery**.
  A merchant with no active endpoint gets no disbursement record at all.
  0057 says it should be written inside `PayoutBatch`'s transaction. Moving
  it there is the proper home, but it is a bigger change to the payout flow.
- `apps/reporting` reads every outbox row and has no `superseded_by` filter.
  Its reports will still count the old duplicates.
- The FP-208 "advisory lock" item in the May postmortem should be reopened or
  removed. It was never implemented.
- A replay gets a new `Webhook-Delivery-Id`, so receivers deduping on that
  header (what the incident review asked merchants to do) can't dedupe
  replays.
