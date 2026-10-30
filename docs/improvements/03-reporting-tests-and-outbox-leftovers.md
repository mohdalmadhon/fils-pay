# 03: Reporting tests failed because API tests left broken events behind

| | |
|---|---|
| **Type** | Test isolation bug, with a real operational risk behind it |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `npm test` in `apps/reporting`: `runRebuild` and three `runConsumerPass` tests, all with `null value in column "merchant_id" of relation "merchant_daily_volume"` |

## What was wrong

The reporting tests pass on a freshly seeded database (11/11). They failed
only after the API tests had run on the same database, which is what
`npm test` does.

Two API tests inserted outbox events they didn't need to be real:

| Where | What it inserted |
|---|---|
| `apps/api/src/webhooks/largeExport.test.ts:77` | 25,000 `transaction.captured` events with payload `{}`, just so each synthetic webhook delivery had an outbox row to reference |
| `apps/api/src/webhooks/archiveReplay.test.ts:64` | one `transaction.captured` and one `transaction.voided` with payload `{}` per run |

The reporting consumer applies `transaction.captured` and
`transaction.voided`. With no `merchantId`, its upsert into
`merchant_daily_volume` fails. A consumer pass is all-or-nothing by design
(`runConsumerPass.ts`; one test proves exactly that), so one bad row blocks
every pass until it is removed. The same would have happened to a local
reporting worker on that database: dashboards silently stop updating.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test(api): largeExport's synthetic outbox rows use a test-only event type` | `test.webhook_archive_fixture`, which nothing consumes. |
| 2 | `test(api): archiveReplay's synthetic outbox rows use a test-only event type` | Same. The deliveries keep their real event types. |
| 3 | `test(reporting): say why the suite fails when the outbox holds malformed events` | `outboxHygiene.test.ts` names the cause instead of four bare NOT NULL errors. |
| 4 | `docs(runbook): dashboards stopped updating because of a malformed outbox event` | How to recognise it, a query to find the rows, and what to do in development vs production. |
| 5 | `docs: improvement 03, reporting tests and outbox leftovers` | This file. |

## Not changed, recommended

The all-or-nothing pass is deliberate and tested, so it was kept. Its cost is
that one malformed event stops reporting for everyone until someone acts.
Real producers always set `merchantId`, so today only tests or manual INSERTs
can cause it. If that changes, consider moving events that fail validation to
a "skipped" table with an alert, rather than blocking the pass.

## Your local database

If your database has run the API tests before this change, it still holds the
old leftovers. The reporting tests and a local worker keep failing until they
are removed. The runbook query finds them; on a dev database, delete them, or
recreate the database.

## Verified

On a seeded database, after running the API `largeExport` and `archiveReplay`
tests, no reporting event lacks a `merchantId`, and the reporting suite passes
12/12 (including the new check).
