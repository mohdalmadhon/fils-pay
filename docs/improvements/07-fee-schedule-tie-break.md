# 07: The API and settlement could pick different fee schedules on the same day

| | |
|---|---|
| **Type** | Money bug |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | Recorded in [`docs/fixes/reconciliation-pending-rate.md`](../fixes/reconciliation-pending-rate.md), item 3. Code: `apps/settlement/internal/settlement/fee_schedule.go:29-33` (`LoadFeeSchedules`, `ORDER BY effective_from ASC` only), against `apps/api/src/fees/feeSchedule.ts:31` (`ORDER BY effective_from DESC, created_at DESC`). |

## What was wrong

When two `fee_schedules` rows share an `effective_from` (a correction keyed in
for the same start date), the later-entered one is the correction.

- **API at capture** (`getEffectiveMdrBps`) picked the later-entered row.
- **Settlement at batch close** loaded rows ordered by `effective_from` only and
  took the last applicable one. Among the tied rows, which came last depended
  on the order Postgres happened to return them.

A test with the correction inserted first (so physical order is the wrong
answer) got 230 bps from settlement against the API's 220. The merchant's
ledger and payout disagree for every capture after that date, and the gap
grows with volume.

A full tie (same `effective_from` and the same `created_at`) was undefined on
both sides.

## Fix

| # | Commit |
|---|---|
| 1 | `test(settlement): on a tied effective date the later-entered schedule wins` (fails before: 230, want 220) |
| 2 | `settlement: break fee schedule ties by entry time, then id` (`ORDER BY effective_from, created_at, id`) |
| 3 | `api: the same last tie-breaker (id) in every fee schedule lookup` (`getEffectiveMdrBps`, the display helper, and the reconciliation price all add `id`) |
| 4 | `docs: note the fee schedule tie-break fix where it was reported` |
| 5 | `docs: improvement 07, fee schedule tie-break` |

The rule everywhere is now: the newest `effective_from` that has arrived; on a
tie, the later `created_at`; on a full tie, the larger `id`.

## Verified

Go: `TestLoadFeeSchedules_SameEffectiveDateLaterEntryWins` and the whole
settlement package pass. API: `fees/*.test.ts` and `settlement.test.ts`, 35/35,
including a new full-tie test.
