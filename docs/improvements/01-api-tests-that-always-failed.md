# 01: Two API tests that failed on every run

| | |
|---|---|
| **Type** | Broken tests (the code was right) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `npm test` in `apps/api`, on `main` before any of this work: the 2 API failures listed in `docs/verification/end-to-end-2026-10-30.md` |

## 1. Fee schedule display

**Where:** `apps/api/src/fees/currentFeeScheduleDisplay.test.ts`, test
*"returns the most recently entered schedule even when an older period was
backfilled later"* (was line 72).

**What was wrong:** the test expected the 245 bps backfill (effective March,
entered 15 August) to be shown as the current rate. That was the display bug
fixed in [`docs/solved-problems/005`](../solved-problems/005-fee-schedule-display.md):
payments after 1 August are charged 225 bps, so the display must show 225.
The 005 fix changed the code but left this test failing on purpose, because
the repo's rules said tests were "locked". An inline comment in the test
(`am: ... it asserts the backfilled row wins`) had already questioned it.

**Fix:** the test now asserts 225 bps for a date after August, and 245 bps for
a date inside the backfilled period. Three more tests cover what 005 had only
checked with a temporary script: a future schedule isn't current before its
cutover, a merchant with only future schedules has no current rate, and on the
same effective date the later-entered correction wins.

## 2. Webhook retry backoff

**Where:** `apps/api/src/webhooks/dispatcher.test.ts`, test *"failing
endpoint: backoff/exhaustion sequence …"* (lines 195 and 215).

**What was wrong:** `backoffDelayMs` adds ±10 % random jitter (by design, since
the first commit `c2f3627`). The test called it with the default random jitter
and asserted the result was **exactly** 1000 ms. That fails whenever the random
number isn't exactly 0.5, so in practice on every run.

**Fix:** the test passes a fixed jitter (`() => 0.5`) when computing the
nominal delay. Its check on the real delivery's `next_attempt_at` already
allowed for the spread. A new `backoff.test.ts` pins the contract: the delay
doubles per attempt, is capped, and the jitter stays within ±10 %.

## Commits

| # | Commit |
|---|---|
| 1 | `test: the fee display test asserts the rate in effect, not the backfill` |
| 2 | `test: fee display handles future schedules and same-day corrections` |
| 3 | `test: the webhook backoff test fixes the jitter it compares against` |
| 4 | `test: unit tests for webhook retry backoff and its jitter bounds` |
| 5 | `docs: improvement 01, API tests that always failed` |

No application code changed.

## Verified

`currentFeeScheduleDisplay.test.ts` 7/7; `dispatcher.test.ts` 8/8 on three
runs in a row; `backoff.test.ts` 3/3.
