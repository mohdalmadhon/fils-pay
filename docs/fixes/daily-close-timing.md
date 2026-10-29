# Fix report: the daily close ran about 3 hours late

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium. Settlement for each business day closed at about **03:15** Bahrain time instead of the documented "shortly after local midnight" (00:15 with the default delay). Payouts and `settlement.paid` webhooks went out three hours later than they should. |
| **Component** | `apps/settlement/internal/scheduler/daemon.go`, `status.go`, `internal/settlement/window.go` |
| **Reported** | "The daily close timing doesn't match what the docs say." |
| **Date** | 2026-10-29 |

## Summary

`ARCHITECTURE.md`: *"A settlement business day runs from midnight to
midnight Asia/Bahrain (UTC+3) … The daemon closes the previous business day
shortly after local midnight."* The **window** was right, but the daemon's
decision about **when** to close was not.

`runIfDue` did this:

```go
now := time.Now().UTC()
todayStart, _ := settlement.BusinessDayWindow(now)   // "today's" Bahrain midnight
businessDate := todayStart.AddDate(0, 0, -1)          // close yesterday
```

`BusinessDayWindow` takes a **calendar date** and reads only its
year/month/day in the value's own location (all its other callers pass a
date, and a test locks that in). Given a UTC instant, it uses the **UTC**
date. From Bahrain midnight until 03:00 (21:00–24:00 UTC), the UTC date is
still the previous day, so for those three hours the daemon thought "today"
was yesterday. It re-closed the day before yesterday, which was already
closed, so it did nothing. The day that had just ended was only closed once
UTC midnight passed: **03:00 + 15 min delay = 03:15 Bahrain**.

FH spotted it in a comment (*"date.Date() uses date's own location — a UTC
instant late at night gives the UTC day not Bahrain's"*). MK replied *"UTC
here is fine, BusinessDayWindow converts to Bahrain"*, and am logged *"logs show
the close ~03:15 local not 00:15?? whatever, it runs"*. `CLAUDE.md` also claims
the boundary is UTC midnight. That's wrong too; ARCHITECTURE.md and `window.go`
say Bahrain.

The daemon's "next check-in" log line had a related problem: it printed
last check + 24 h, rendered in the container's `TZ` (unset, so UTC). It said
nothing about when the close would actually happen.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `settlement: add BusinessDateAt, the Bahrain calendar date of an instant` | Converts an instant to its Asia/Bahrain date. `BusinessDayWindow`'s doc now says it takes a date, not an instant. Its behaviour is unchanged, so every other caller and the window tests are unaffected. |
| 2 | `scheduler: close the business day shortly after Bahrain midnight, not UTC midnight` | The decision moves into a pure `dueBusinessDate(now, delay)`, which uses `BusinessDateAt`. `runIfDue` calls it. |
| 3 | `scheduler: log when the next daily close will really happen` | The estimate is now the next Bahrain midnight + delay, by the same rule. The existing status test's expected instant is unchanged. |
| 4 | `test: the daily close runs after Bahrain midnight, for the day that just ended` | `close_timing_test.go`, 4 tests across the 00:00–03:00 window, UTC midnight and a year boundary, with the clock given in either zone. |
| 5 | `docs: daily close timing fix report` | This report. |

## Verification

- `close_timing_test.go`: 4/4 pass. With the old decision logic in place:
  - At 00:05 Bahrain the old code said a close was due. It wasn't; it would
    have closed the day before yesterday.
  - At 00:16 it closed the day that ended at **29 Oct 00:00** instead of
    **30 Oct 00:00**.
- `go test ./internal/scheduler/`: all pass, including the existing status tests.
- `RunDailyBatch`, the window tests and `run-batch --date` are unchanged, and
  still pass in the full Go suite.

## Deploying

Restart the settlement daemon. The first close after the deploy happens at
00:15 Bahrain time. Nothing needs backfilling: every day was still closed,
just late. If anything downstream was scheduled around a 03:15 close (a
report, an export), it can move earlier.

## Related, not changed here

- `CLAUDE.md`'s "Settlement windows use UTC midnight boundaries" is wrong and
  should be corrected.
- `window_utc_compat_test.go` (*"UTC compat for the march reconcile script"*)
  only checks the existing Bahrain window. Its name and comments are
  misleading, but what it asserts is right.
