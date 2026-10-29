# 004 — MDR recalculation rewrites finalized batches

Recorded: 2026-10-29. This is the MDR issue the user called "problem 4";
it is distinct from the earlier admin/CLI balance-rebuild issue in record 003.

Status: fixed locally and verified with synthetic PostgreSQL data. No
production recalculation, historical rewrite, or corrective posting was run.

## Problem and root cause

The user reported that MDR recalculation changed already-paid batches,
despite the settlement team's understanding that it only touched open
batches. Closed batches were changing too.

The original selector in `RecalculateMDR` was the inverse of that policy:

```sql
AND status <> 'open'
```

With the available states `open`, `closed`, and `paid`, this selected both
finalized states and excluded open batches. There was no later paid-state
skip. For a changed fee, the function:

1. Recomputed all linked events at the merchant's current MDR and discount.
2. Overwrote the original batch's `fee_fils` and `net_payout_fils`.
3. Posted two ledger legs dated now but linked to that historical batch.
4. Changed the cached balance by the fee delta.

An already-paid 10.000-BD batch with a 0.250-BD fee could therefore be
rewritten from a 9.750-BD net to 9.700 BD after a rate change, although the
original payout and child allocations still reflected 9.750 BD. Posting a
balanced adjustment does not make rewriting that paid figure correct.

The code comment claimed the correction landed in the current period's
batch and kept paid figures unchanged. The timestamp was current, but the
foreign key pointed to the old batch and its totals were updated directly.

## Fix

Both selection and update now require `status = 'open'`. Existing row locks
serialize the operation with `CloseBatch`; closed and paid batches are
skipped regardless of a rate change or a mixed-state date range.

Changing that filter alone would not make open-batch recalculation work:
`CloseBatch` links capture events to a batch only while closing it. Open
batches normally have no linked events. The old linked-event query would
therefore see no captures and could replace provisional fees with zero.

The corrected implementation reads eligible unbatched `captured` and
`partially_captured` events for the merchant's business-day window. It
computes provisional gross, fee, and net with the same effective-date MDR
resolution, fallback rate, discount, tier reduction, per-event rounding,
and net helper as `CloseBatch`. It leaves those existing fee and net rules
unchanged.

No ledger, cache, export, split, payout, event-claim, or platform-volume
write is performed by the preview. The old historical adjustment writer
was removed from this path. `CloseBatch` remains responsible for final
figures; previews do not freeze a rate or promise a payout amount.

## Changed files and affected locations

Line numbers describe this implementation; use the named functions if the
file moves. The pre-fix code and comments are available with
`git show 5bd6d95:<path>` for the paths below.

| Location | Change |
|---|---|
| [recalculate_mdr.go:43](../../apps/settlement/internal/settlement/recalculate_mdr.go#L43), `RecalculateMDR` | Define open-only provisional behavior; select `status = 'open'`, retain row locks, update totals only while still open, and remove ledger/cache adjustment calls |
| [recalculate_mdr.go:137](../../apps/settlement/internal/settlement/recalculate_mdr.go#L137), `recomputeOpenBatchTotals` | Replace the finalized linked-event scan with the same eligible unbatched capture selection and fee rules as closing |
| [admin.ts:50](../../apps/api/src/routes/admin.ts#L50), `RecalcMdrBody`, and the MDR route | Correct the contradictory closed/open/paid comments while preserving route authorization, request shape, and audit handling |
| [server.go](../../apps/settlement/internal/internalapi/server.go), `handleRecalculateMDR` | Correct the handler description; keep the existing route and response projection |
| [cache.go:23](../../apps/settlement/internal/balances/cache.go#L23) | Replace the obsolete claim that MDR recalculation changes paid-batch caches; no cache implementation change |
| [mdrRecalculation.ts](../../apps/admin/src/api/mdrRecalculation.ts), `recalculateMdr` | Correct the frontend API comment that suggested paid batches could be adjusted safely |
| [SettlementPage.tsx:333](../../apps/admin/src/pages/settlement/SettlementPage.tsx#L333), MDR section | Explain open-only preview behavior and distinguish zero eligible batches from historical batches already matching a rate |
| [Admin guide](../ADMIN.md#money), [runbook](../RUNBOOK.md#mdr-recalculation), and [ADR 0008](../adr/0008-mdr-finalized-batches.md) | Record operator behavior, finalized-state policy, and historical remediation limits |

Frozen money code, historical migrations, and regression-locked tests were
not modified. This is a guard on MDR recalculation, not a new global database
immutability constraint across unrelated admin actions.

## Repository reference trail

These are the substantive references found during the repository search.
Historical documents and fixtures are preserved as evidence; the current
operator guide and live UI now describe the corrected behavior.

| Reference | Relevance and evidence limit |
|---|---|
| [Finance discussion, September 11](../archive/slack-export-fp-finance-2026-09.txt#L52) | Huda reports nine adjusted Delta Marketplace batches, −41.870 BD; Ali asks whether paid August batches are touched; MK replies that the paid figure stays unchanged. That assurance contradicted the implementation. |
| [Audit export, row 67](../exports/admin-audit-2026-09.csv#L67) | Records `mdr_recalculation` for Delta Marketplace, August 1–September 10, nine adjusted batches and −41,870 fils. It does not establish each affected batch's status or original paid amount. |
| [July 8 finance meeting, MDR changes](../meetings/2026-07-08-finance-eng.md#5-mdr-changes) | Plans to apply changed discount terms to historical August batches. |
| [September 17 FP-203 review](../meetings/2026-09-17-fp-203-review.md#background) | Records a later balance rebuild after recalculation and manual display adjustments; it is related history, not proof of the MDR delta for each batch. |
| [Settlement v2 design, current pipeline](../design/settlement-v2.md#L37) | Explicitly identifies rewriting closed batch rows and attaching corrections to the old batch as an existing v1 problem. |
| [ADR 0005 context](../adr/0005-settlement-v2-shadow-ledger.md#context) | Lists MDR recalculation among historical settlement correction special cases; v2 remains a separate, paused proposal. |
| [Architecture settlement lifecycle](../ARCHITECTURE.md#settlement) | Says batch closing freezes figures and reruns leave closed and paid batches alone. That describes closing; the previous recalculation path broke the corresponding historical expectations. |
| [Changelog 1.7.0](../../CHANGELOG.md#170---2026-06-03) | Records the admin MDR recalculation feature's introduction. |
| [Pre-fix Go recalculation](../../apps/settlement/internal/settlement/recalculate_mdr.go) at baseline `5bd6d95` | Contains the inverted status filter, historical row update, current-period comment, and inline question about FP-244; no fix was present despite that comment's suggestion. |
| [Pre-fix admin route](../../apps/api/src/routes/admin.ts) at baseline `5bd6d95` | Its request comment says only closed batches; inline comments claim only open batches and that selected paid batches are skipped later. Those statements conflict with each other and with the Go path. |
| [Pre-fix frontend API wrapper](../../apps/admin/src/api/mdrRecalculation.ts) and [page](../../apps/admin/src/pages/settlement/SettlementPage.tsx) at baseline `5bd6d95` | Wrapper questions the paid rewrite; page describes changing historical batches and posting ledger adjustments. |
| [API settlement client](../../apps/api/src/admin/settlementClient.ts), `triggerMdrRecalculation`, and [Go HTTP handler](../../apps/settlement/internal/internalapi/server.go), `handleRecalculateMDR` | Forward the operator's request to the Go helper and return its summary. Neither supplied an independent finalized-state guard. |
| [Batch lifecycle implementation](../../apps/settlement/internal/settlement/batch.go), `CloseBatch`, and [frontend response types](../../apps/admin/src/types.ts), `MdrRecalcSummary` | Closing freezes totals and claims capture events. The response's legacy `adjusted` field is retained for compatibility, but now describes provisional updates rather than historical ledger adjustments. |
| [Pre-fix cache comment](../../apps/settlement/internal/balances/cache.go) at baseline `5bd6d95` | Explicitly questions changing a paid batch's cache; the reply treats it as intended. |
| [Recalculation regression tests](../../apps/settlement/internal/settlement/recalculate_mdr_test.go) | Build closed batches and expect rewritten fees, net totals, or an adjustment group. They test the previous behavior and do not protect paid figures. |
| [Split-payout investigation](002-split-payout-allocation.md#historical-investigation) | Notes that a parent's stored net may have been changed after payout, so current parent totals need not describe original child payouts. |
| [Saved settlement batch snapshot](../exports/settlement-batches-2026-09-01_20.csv) | Provides point-in-time batch figures, not a complete before/after history for the recalculation. |

## Verification

A temporary Go harness used synthetic merchants and batches in the local
development database. It was removed from the working tree afterward.

- In a range containing open, closed, and paid batches, only the open batch
  was considered and updated; finalized batch rows were byte-for-byte
  unchanged as JSON snapshots.
- Ledger entries, cached balance, finalized split allocations, and scheme
  export rows were unchanged. Other merchants and out-of-range open batches
  were unchanged too.
- Eligible full and partial captures were included; authorization/void
  events, previously batched captures, and out-of-window events were excluded.
  Exact Bahrain midnight boundaries were exercised.
- Effective fee schedules, discount and platform-tier rules were reflected
  in the preview. Repeating the same request made no further changes, and
  previewed events remained unclaimed.
- Concurrent close and recalculation completed without rewriting a finalized
  batch. With unchanged inputs, closing produced the previewed gross and fee.
  A subsequent rate change and recalculation selected zero finalized batches
  and left their stored rows unchanged.

Final checks:

- Admin frontend build and TypeScript type checking passed.
- The full PostgreSQL-backed `go test ./...` run did not pass. Four locked
  MDR tests assert the former finalized-batch behavior:
  `TestRecalculateMDR_RecomputesAtCurrentRate`,
  `TestRecalculateMDR_AdjustmentLedgerGroupBalances`,
  `TestRecalculateMDR_UnchangedRateAdjustsNothing`, and
  `TestRecalculateMDR_OutOfRangeBatchUntouched`. They create closed batches
  and expect them to be considered or rewritten, or expect a posted
  adjustment. The corrected function considers zero such batches and posts
  no adjustment. These tests were not edited or bypassed.
- The same Go run still has the two balance-refresh expectation failures
  recorded in [the earlier investigation](003-admin-balance-rebuild-source.md#verification).
  The internal API, config, money, scheduler, and split packages passed.
- The full PostgreSQL-backed `npm test` run did not pass. Missing tables
  include `live_sessions`, `credit_requests`, `adjustment_imports`, and
  `reporting_saved_filters`, following the existing local migration failure.
- `git diff --check` and documentation file-link checks passed. There is no
  claim of a green full backend suite.

## Historical remediation and limits

This fix prevents future MDR recalculation from rewriting finalized
batches. It does not reconstruct original figures or undo previous ledger
adjustments. No automatic financial correction or production data update
was performed.

For each affected historical batch, compare its original payout instruction,
split allocations, exports, adjustment ledger groups, and audit records.
The current stored net alone is insufficient evidence of the amount actually
paid. Any approved correction needs a separate auditable adjustment process;
this change does not introduce one. Never reopen a paid batch merely to
force a recalculation or replay its payout.

The existing net calculation, fee-discount rules, volume counter, balance
rebuild behavior, and local migration failure remain outside this fix.
An unchanged preview can legitimately change before closing if its inputs
change. Historical document claims are retained for explanation, not as
current instructions to rewrite finalized history.
