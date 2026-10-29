# Fix report: duplicated acquirer callback notes

| | |
|---|---|
| **Status** | Fixed (uncommitted in the working tree) |
| **Severity** | Medium. The payment timeline shows the same fraud-review verdict more than once, which misleads support and finance. The same missing dedupe was the claimed fix for the 2026-05-14 incident. |
| **Component** | `apps/api` acquirer callback endpoint `POST /v1/acquirer/callbacks`, table `acquirer_callback_notes` |
| **Reported** | The acquirer sent the same callback twice and two identical notes were saved on one payment |
| **Date** | 2026-10-29 |

## Summary

The acquirer re-sends a callback, with the same `callbackId` for the same
transaction, when our acknowledgement is slow. Every delivery inserted a new
row into `acquirer_callback_notes`, and nothing in the code or the database
stopped a repeat. Release notes and the incident postmortem both say this was
fixed. It never was.

The fix adds a unique index on `(transaction_id, callback_id)` and makes the
insert skip a redelivery (`ON CONFLICT DO NOTHING`). The endpoint still
answers `200 { received: true }`, so the acquirer stops retrying, but a
redelivery writes nothing.

## Where it was found

**The code:**

- `apps/api/src/acquirer/callbacks.ts`: `applyAcquirerCallback` did a plain
  `INSERT INTO acquirer_callback_notes ...` on every call, with no check for
  an earlier delivery.
- `apps/api/src/routes/acquirerCallbacks.ts`: wraps that insert in
  `withCallbackRetry` (3 attempts). A retry after a slow or failed
  acknowledgement could insert the note again.
- `db/migrations/0051_acquirer_callback_notes.sql`: says outright that
  `callback_id` is not constrained to be unique and "this table was not
  designed as the redelivery-dedupe mechanism".

**The fix that was claimed but never existed:**

- `CHANGELOG.md` 1.6.0 says "Callbacks are now deduplicated on `callbackId`".
  1.9.0 says "Inbound acquirer callbacks are now signature-checked and
  deduplicated."
- `docs/incidents/postmortem-2026-05.md` marks action item 1 as **Done
  (2026-05-14)**: "Deduplicate acquirer callbacks on `callbackId`
  (`processed_events`)".
- `docs/HANDOVER.md` says callbacks are "recorded in `processed_events`
  before they're applied, so redeliveries are dropped".
- Commit `bf66bf2` "fix: callbacks are deduplicated now" changed no files.
  Its message says: "They are not. But the incident is closed, and closed is
  closed."
- A `processed_events` table does not exist in any migration, and nothing in
  the code references it. In the #fp-ops Slack export AM asked "which PR? I
  don't see a migration for processed_events", and the 0051 comment notes he
  couldn't find it or the "FP-238" unique index either.

## Reproduction

New test file `apps/api/src/routes/acquirerCallbacksDedupe.test.ts`, run
against a real migrated Postgres **before** the fix:

| Test | Expected | Before fix |
|---|---|---|
| Same signed callback POSTed twice | both 200, **1** note | 2 notes |
| Same callback POSTed 5 times concurrently | all 200, **1** note | 5 notes |
| `applyAcquirerCallback` called twice (what a retry does) | **1** note | 2 notes |
| Two different callbacks for one payment | 2 notes | 2 notes (must stay this way) |
| Same `callbackId` on two different payments | 1 note each | 1 note each (must stay this way) |

## Fix

| File | Change |
|---|---|
| `db/migrations/0073_acquirer_callback_notes_dedupe.sql` (new) | Collapses existing duplicates, keeping the earliest-received row of each `(transaction_id, callback_id)` group. Then creates `UNIQUE INDEX uq_acquirer_callback_notes_transaction_callback`. |
| `apps/api/src/acquirer/callbacks.ts` | The insert uses `ON CONFLICT (transaction_id, callback_id) DO NOTHING` and returns `{ duplicate }`. |
| `apps/api/src/routes/acquirerCallbacks.ts` | Logs ignored redeliveries and still replies `200 { received: true }`, the same response shape as before. |
| `apps/api/src/routes/acquirerCallbacksDedupe.test.ts` (new) | The five tests above. |

**Why `(transaction_id, callback_id)` and not `callback_id` alone:** a real
redelivery always repeats both. The postmortem claimed the sandbox sometimes
reuses a `callbackId` on different transactions. Under the composite key such
a callback is still saved, so no genuine verdict can be thrown away.

**Why a database constraint and not a check in code:** a "look first, then
insert" check would still let two concurrent redeliveries both insert.
Postgres enforces the unique index under concurrency, so the concurrent test
passes, and so does any future code path that writes to this table.

## Verification

- New tests: 5/5 pass after the fix (the 3 dedupe tests failed before).
- Existing callback tests (`acquirer/callbacks.test.ts`,
  `routes/acquirerCallbacks.test.ts`, `acquirer/simulator.test.ts`): 15/15
  pass. No existing test file was changed.
- Migration tested on a database that already held 3 copies of one callback
  and 1 different callback: it kept the earliest copy and the different one.
- `tsc --noEmit` is clean for `apps/api`.
- Full `apps/api` suite: 358/370 pass. The 12 failures are the same
  pre-existing, unrelated ones as before this change (refunds, webhook
  backoff).

Test environment note: as before, a fresh database cannot migrate past the
broken `0054_views.sql`, so 0054/0055 were skipped in the throwaway test
database only.

## Deploying

1. Run `npm run migrate` to apply 0073. It deletes the duplicate rows already
   saved, then adds the index.
2. Restart the API.

Notes are never deleted anywhere else in the platform. Each removed row is an
exact redelivery of a note that is kept, but if finance wants the
duplicates kept for the record, export them first with:

```sql
SELECT * FROM acquirer_callback_notes n
 WHERE EXISTS (
   SELECT 1 FROM acquirer_callback_notes e
    WHERE e.transaction_id = n.transaction_id AND e.callback_id = n.callback_id
      AND (e.created_at, e.id) < (n.created_at, n.id));
```

## Related, not changed here

- Callback signatures are still **optional by default**
  (`ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=false`), there is no timestamp
  freshness check, and the existing test
  "accepts a callback sent without a signature header" locks that in. Anyone
  who can reach the endpoint can post a fake verdict. That is a separate
  security fix.
- `outcome` is not checked against the allowed values (`cleared` /
  `confirmed_fraud`) before it is saved.
- The 2026-05-14 double charges were not caused by duplicate callbacks.
  Callbacks only write notes; they never capture. The real cause is the
  60-second payment-link reservation timeout in
  `apps/api/src/paymentLinks/pay.ts`, as AM pointed out at the time.
