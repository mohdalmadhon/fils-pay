# 005 — Fee display selects a historical backfill

Recorded: 2026-10-29.

Status: implemented locally and verified against synthetic schedules and
the real capture implementation using a simulated acquirer in local
PostgreSQL. Production rows and payment history were not changed.

## Reported problem and traced screen

Support reported a displayed fee of 245 bps while payments used 225 bps,
with different dates and a later historical backfill involved.

The repository contains this exact scenario in Alpha Retail's seed fixture
and the fee-display regression test. The concrete display traced here is
the admin merchant-detail profile used by support, not a separate fee field
found in `apps/web`. Its API returns `currentFeeSchedule`, which the page
labels **Current negotiated rate**. Production's precise screen and rows
have not been inspected, so the fixture demonstrates the defect without
establishing the complete production incident.

There are two rate sources, `merchants.mdr_bps` as a fallback and negotiated
history in `fee_schedules`. The 245/225 discrepancy is between two lookup
rules for the same `fee_schedules` table, not between two independent
negotiated-fee tables.

## Root cause

Every schedule has two dates:

- `effective_from`: when the rate begins applying.
- `created_at`: when someone entered that historical record.

The saved fixture is:

| Rate | Effective from | Entered at | Meaning |
|---|---|---|---|
| 225 bps = 2.25% | 2026-08-01 | 2026-08-01 | Newer negotiated rate |
| 245 bps = 2.45% | 2026-03-01 | 2026-08-15 | Later-entered correction to an older period |

The payment lookup selected the latest already-effective schedule, so a
capture after August 1 used 225 bps. The display instead ordered by
`created_at DESC`, choosing the historical 245-bps correction because it
was typed in later. It also lacked an effective-date cutoff, allowing a
future schedule to appear current before it applied.

The backfill itself was not the defect: its effective date correctly
limits the period it describes. Entry order was incorrectly treated as
the date a rate became current. The original helper's interface comment
described an already-effective schedule, while its implementation and
longer comment intentionally selected the newest entered row.

## Fix and affected lines

The display now uses the same selection rule as capture:

```sql
WHERE merchant_id = $1 AND effective_from <= $2
ORDER BY effective_from DESC, created_at DESC
LIMIT 1
```

The lookup's `asOf` argument defaults to the current time. Entry time only
breaks ties between rows with the same effective date. No applicable
schedule returns `null`, preserving the existing merchant-base-MDR fallback
contract and response fields. Dates returned in the response belong to the
selected effective row, not the late-entered backfill.

| File and location | Change or role |
|---|---|
| [currentFeeScheduleDisplay.ts:14](../../apps/api/src/fees/currentFeeScheduleDisplay.ts#L14), `getCurrentFeeScheduleForDisplay`, lines 14–37 | Correct the documentation, add the optional lookup instant, exclude future rows, and order by effective date before entry date |
| [types.ts:152](../../apps/admin/src/types.ts#L152), `CurrentFeeScheduleDisplay` | Replace the obsolete claim that the newest-entered row is returned; response shape is unchanged |
| [MerchantDetailPage.tsx:263](../../apps/admin/src/pages/merchants/MerchantDetailPage.tsx#L263), profile rates | Label the merchant default as **Base MDR (fallback)** and say no schedule is "in effect" when only future rows exist |
| [Admin guide](../ADMIN.md#merchants) | Explain both date meanings, fallback behavior, and the historical-backfill example |

The capture rate selector, money packages, merchant records, schedule rows,
and historical migrations were not changed. This is a display-selection
correction, not a repricing, backfill migration, or historical fee reversal.

## Repository references and previous mentions

The original implementation and removed comments can be inspected with
`git show a1a8978:<path>`. The substantive references found are:

| Reference | What it establishes |
|---|---|
| [Seed generator, lines 809–829](../../db/seed/generate.ts#L809) | Contains the exact Alpha Retail 225/245-bps example and explains that the March rate was corrected during an August data-quality cleanup after the newer negotiated rate existed |
| [Display regression test, lines 71–83](../../apps/api/src/fees/currentFeeScheduleDisplay.test.ts#L71) | Explicitly expects the backfilled 245-bps row to win; an inline comment questions that expectation. This locks in the old display behavior rather than agreement with capture. |
| [Original display helper](../../apps/api/src/fees/currentFeeScheduleDisplay.ts) at baseline `a1a8978` | Orders by entry date with no effective-date filter. An inline June 15 question identifies the backdated-row issue; replies dismiss it as display-only. |
| [Capture rate resolver](../../apps/api/src/fees/feeSchedule.ts#L22), `getEffectiveMdrBps` | Uses `effective_from <= asOf`, newest effective date first, with entry date as tie-breaker and merchant MDR fallback |
| [Rate resolver tests, lines 56–84](../../apps/api/src/fees/feeSchedule.test.ts#L56) | Cover inclusive cutovers and effective-date ordering rather than insertion order. An old comment notes the display did the opposite. The locked test file is preserved. |
| [Fee-schedule migration](../../db/migrations/0048_fee_schedules.sql) | Defines the two timestamps and effective-date lookup index. Its opening comments describe versioned rates; a later contradictory comment calls the newest entered row "current". Historical migration text is preserved. |
| [Merchant schema](../../db/migrations/0002_merchants.sql#L3) | Defines `merchants.mdr_bps` as the fallback when a negotiated schedule applies instead |
| [Admin detail assembly](../../apps/api/src/admin/merchants.ts#L283) | Calls the display helper and returns it as `currentFeeSchedule`; no alternate schedule selector is added by the route |
| [Merchant-detail frontend](../../apps/admin/src/pages/merchants/MerchantDetailPage.tsx#L263) | Renders the fallback MDR separately from the negotiated schedule's rate and effective date |
| [Original frontend type comment](../../apps/admin/src/types.ts#L152) at baseline `a1a8978` | Describes the display as newest-entered and acknowledges that it need not govern billing |
| [Capture implementation](../../apps/api/src/payments/capture.ts#L162) | Resolves MDR at capture time, applies any platform-volume reduction, and posts the resulting fee to the ledger |
| [Settlement fee schedule](../../apps/settlement/internal/settlement/fee_schedule.go) | Resolves schedules against each event's effective time rather than the last entered row; equal-effective-date ordering was not changed by this display fix; since [improvement 07](../improvements/07-fee-schedule-tie-break.md) it breaks ties by `created_at`, then `id`, like the API |
| [Architecture settlement description](../ARCHITECTURE.md#settlement) | Identifies fee schedules with merchant MDR fallback as the source of settlement rates |
| [Settlement v2 fee description](../design/settlement-v2.md#L102) | Describes rates as effective at the event time; it is design context, not proof of a deployed v2 system |

No support conversation or production audit row specifically recording this
245/225-bps display complaint was found in the saved documents. Numeric
matches in unrelated export IDs and amounts are not evidence of this issue.

## Verification

A temporary TypeScript harness exercised the actual display and capture
helpers with synthetic merchants. It was removed from the working tree
afterward; regression-locked test files were left unchanged.

- The exact backfill example returns 225 bps by default today, 245 bps for
  March–July lookups, and 225 bps starting exactly at August 1 midnight.
  The selected row's effective and entry timestamps both describe August 1.
- A future 2099 schedule is ignored before its cutover and selected exactly
  at the cutover. A future-only merchant returns no current negotiated row,
  with capture retaining that merchant's base MDR fallback.
- Merchants without schedules retain their fallback, and another merchant's
  schedules do not affect the lookup.
- With equal effective dates and different entry dates, both display and
  capture select the correction entered later.
- The actual `captureTransaction` path, with a simulated approved acquirer
  and a 10,000-fil synthetic payment, posted a 225-fil fee. The local volume
  tier reduction was zero. The displayed negotiated rate was 225 bps.
- Schedule-row snapshots were unchanged by the lookups and capture.

Final checks:

- API and admin TypeScript checks passed. The admin production build passed.
- The full PostgreSQL-backed `npm test` run did not pass. The locked test
  `returns the most recently entered schedule even when an older period was
  backfilled later` expects 245 bps; the corrected result is 225 bps. It was
  not changed or bypassed. Capture resolver tests passed, including effective
  date ordering and inclusive cutovers.
- That npm run also encountered existing missing-schema failures, including
  `live_sessions`, `credit_requests`, `adjustment_imports`, and
  `reporting_saved_filters`, following the previously recorded migration
  failure.
- The full PostgreSQL-backed Go suite retained the two balance-refresh and
  four finalized-MDR expectation failures documented in records
  [003](003-admin-balance-rebuild-source.md#verification) and
  [004](004-mdr-finalized-batches.md#verification). This display fix changed
  no Go code.
- Documentation file links and `git diff --check` passed. There is no claim
  of a green full backend suite.

## Scope and remaining limits

- The negotiated MDR is a schedule rate, not a guarantee that every final
  fee divided by payment amount equals that rate. Platform reductions,
  negotiated discounts, and integer-fils rounding remain separate rules.
- Matching the existing capture selector does not address rows tied on
  both effective and entry timestamps, or Go's ordering of rows with equal
  effective dates. No uniqueness constraint or tie policy was introduced.
- Existing production fee history was not audited or corrected. The
  historical 245-bps row remains valid data for its earlier period.
- The running API uses a non-watching dev command; it needs a restart to
  load this code. This change does not restart or deploy services.
