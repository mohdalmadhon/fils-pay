# 05: The platform volume counter would overflow just past the tier threshold

| | |
|---|---|
| **Type** | Money bug (new finding, made while fixing improvement 02) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `db/migrations/0049_platform_stats.sql:7` (`total_processed_fils INTEGER`); `apps/settlement/internal/settlement/platform_volume.go:13-46` (`int32` read, `int32` add, `int32` threshold); `apps/api/src/fees/platformVolumeTier.ts:6` (a note saying the column "is BIGINT so no overflow risk") |

## What was wrong

Every batch close adds its gross to `platform_stats.total_processed_fils`.
Once the total reaches 2,000,000,000 fils (2,000,000 BD), every merchant gets
a 15 bps volume-tier discount.

- The column was `INTEGER`: max 2,147,483,647 fils, only ~7 % above the
  threshold.
- Settlement read it into an `int32` and added each batch with
  `current + int32(batchGrossFils)`. Past the limit the sum wrapped negative
  (2,100,000,000 + 100,000 BD → −2,094,967,296), which Postgres accepted, and
  the discount switched off for everyone. A single batch over 2,147,483 BD
  would also have been truncated.
- The API note claiming the column was `BIGINT`, "double-checked", was wrong.

## Fix

| # | Commit |
|---|---|
| 1 | `test(settlement): the platform volume counter counts past int32` (fails before: −2,094,967,296) |
| 2 | `db: widen platform_stats.total_processed_fils to BIGINT` (migration 0080, lossless) |
| 3 | `settlement: keep the platform volume counter in int64` |
| 4 | `api: read the BIGINT platform volume counter as a number` (pg returns BIGINT as a string; new test at 5,000,000,000 fils) |
| 5 | `docs: improvement 05, platform volume int32` |

## Verified

`go test ./...` in `apps/settlement`: all pass. API `platformVolumeTier*.test.ts`
and `settlement.test.ts`: 19/19. The new API test fails on a database without
0080.

## After deploying

Run `npm run migrate` before the next settlement run (0080).
