# 013 — Integrate finance fixes with main

Recorded: 2026-10-29.

Inputs: main `b55812e` and finance-problems `13ebf6a`, diverging from
`fb0de7c`. The first merge stopped on 14 conflicted paths. The user then
authorized resolution while retaining fixes for different problems.

## Integration decisions

| Area | Result |
|---|---|
| Payment links | Preserve main's database-clock expiry and transactional reservation/payment fixes. Keep finance's authenticated merchant ID and scoped cancellation queries. Do not forward client `submittedAt` into payment. |
| Scheduling | Preserve main's `BusinessDateAt`, private `dueBusinessDate`, corrected logger, and tests. Retain finance's `BusinessDayWindowAt` and exported `DueBusinessDate` as wrappers around the same date calculation. |
| Balance rebuild | Keep main's aggregate ledger query, cache table lock, and direct admin/CLI calls to `RebuildAllBalances`. Keep `refresh.go` deleted. Finance's source correction survives through that common ledger path. |
| Splits | Keep main's general `ChildShares` helper and proportional/nonpositive-total compatibility. Actual database payouts use finance's checked allocator: positive weights totaling 10,000, nonnegative net payout, shared configuration locks, exact conservation, and no zero-value ledger legs. |
| CSV parsing | Both branches use `parseBhdToFils`. Keep main's detailed explanation and combined import limits, validation, and UI improvements. |
| Test merchants | Both preserve test/live flags during status recomputation. Also retain main's corrected open-authorization count. |
| Other fixes | Retain finance's open-only MDR, effective-date fee display, authenticated-session predicate, integer lifetime counter/migration, and safe March sweep. Preserve main's separate OTP hardening and other independently merged fixes. |
| Architecture | Combine finance's counter, scheduling, and ownership documentation with main's expiry, webhook signing, and signature-enforcement descriptions. Normalize resolved whole-file conflicts from CRLF to LF. |
| ADRs | Canonical 0007 remains main's `0007-balance-rebuild-reads-the-ledger.md`. Keep finance's independently numbered 0007 as historical context with a superseded status, preserving its decision text. Index canonical 0007 and MDR 0008. |

The split policy deliberately rejects invalid configured basis-point totals
at the money-moving database boundary; it does not silently reinterpret
them as a new agreement. The general helper's interface is retained for
unrelated callers and locked tests. Both allocators use exact
largest-remainder arithmetic for valid configured weights.

No test file or frozen money implementation was edited during resolution.
Main's already-committed Go money allocator remains unchanged.

## Conflict provenance

`git blame -w` and commit history identify these overlapping main changes:

- `fa32c97`: payment-link expiry; also converted every line of
  `paymentLinks.ts` and `ARCHITECTURE.md` to CRLF, inflating conflicts.
- `ef248d3`: split allocation with different input-policy choices.
- `f2b115f` and `8e63ece`: scheduling and Bahrain-date helper interfaces.
- `6db6a81`: aggregate/locked rebuild, wrapper deletion, ADR 0007.
- `be74ab0`: BD parsing explanation.
- `39d66d9` and `7b8000e`: test-mode-preserving recompute and documentation.
- `ae20153`: additional webhook-security architecture documentation.

Most remaining conflicts were explanatory comments. Whole-file selection
would discard distinct fixes or introduce helper-interface errors.

## Migration compatibility

Both branches added a different filename beginning with 0073:
`0073_acquirer_callback_notes_dedupe.sql` and
`0073_lifetime_payout_estimate_integer_fils.sql`. Keep both filenames.
The [runner](../../db/migrate.ts) sorts and tracks **full filenames**, so
these are separate migrations. Use full filenames in deployment instructions;
do not rename historical migrations. The lifetime backfill retains its
separate DBA deployment plan.

## Verification

- Full workspace, database, and script TypeScript checks passed.
- In a disposable database, Go config, internal API, ledger, money,
  scheduler, and split packages passed. The only failures were four
  existing MDR tests expecting finalized-batch rewrites, deliberately
  preserved as locked tests rather than weakening the open-only fix.
  Main's concurrent payout-notification tests passed with migration 0075.
- The disposable npm run retained six failures: the old fee-backfill
  display expectation, one dispatcher timing assertion (980 ms versus
  1000 ms), and four reporting tests encountering an outbox payload with
  a null merchant. Payment-link expiry, normal payment-link routes,
  test-mode recomputation, and OTP checks reported no failures. The
  dispatcher and reporting source were not changed by this merge.
- The required full suites were also run on the shared local database;
  its incomplete migration state adds missing-table/column failures.
- Additional real-function verification passed: 50,020 exact allocation
  checks; seven PostgreSQL split cases including invalid configurations,
  negative/zero totals and concurrent retries; open-only MDR with
  concurrent closing; 35 HTTP cancellation-ownership checks.
- Conflict-marker and documentation-link checks passed. No locked test
  was edited. The full suites are not green.

Disposable databases applied the actual migration files except the two
pre-existing broken files, 0054 (missing settlement_batch_events) and 0055
(incompatible chart-of-accounts columns). This is selected-schema local
verification, not a claim that a fresh full migration run works. Both
0073 files and the later migrations were applied. Every disposable database
was dropped. No production migration or real payout was run.

## References

- [Payment-link expiry](../fixes/payment-link-expiry.md) and
  [cancellation ownership](011-payment-link-cancel-ownership.md).
- [Main daily-close timing](../fixes/daily-close-timing.md) and
  [finance scheduling](008-daily-close-bahrain-time.md).
- [Canonical balance ADR](../adr/0007-balance-rebuild-reads-the-ledger.md),
  [finance investigation](003-admin-balance-rebuild-source.md), and
  [historical finance ADR](../adr/0007-ledger-backed-admin-balance-rebuild.md).
- [Main split report](../fixes/split-payout-rounding.md),
  [finance allocation](002-split-payout-allocation.md),
  [public helper](../../apps/settlement/internal/splits/shares.go), and
  [database payout](../../apps/settlement/internal/splits/allocate.go).
- [Test mode](010-test-merchants-in-settlement.md),
  [MDR](004-mdr-finalized-batches.md),
  [lifetime counter](009-lifetime-payout-estimate.md), and
  [March sweep](012-march-sweep-repeat-postings.md).

Original records retain their historical findings and validation.
Integration notes identify later implementations or additional fixes.
