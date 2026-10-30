# Merging main into UI/UX (2026-10-30)

`main` (the future-fixes audit, 22 commits up to `9571805`) was merged into
`UI/UX` (the redesign, which also carries the `cyper` security review and
`docs/improvements`). Both lines had fixed some of the same bugs
independently, so the merge needed decisions, not just text edits. This
records each one, where it was found and why it was resolved that way.

## Conflicts

| File | UI/UX | main | Kept |
|---|---|---|---|
| `apps/settlement/internal/settlement/platform_volume.go` | improvement 05: counter is `int64`; Go adds the batch, writes the sum | audit 05: counter is `int64`; Postgres adds `$1::bigint + $2::bigint` | main's write (Postgres reports BIGINT overflow instead of Go wrapping), UI/UX's note on why it is 64-bit |
| `apps/settlement/internal/settlement/fee_schedule.go` | improvement 07: `ORDER BY effective_from, created_at, id` | audit 17: `ORDER BY effective_from, created_at` | UI/UX's: main's rule plus an `id` tie-break, matching the API (`apps/api/src/fees/feeSchedule.ts`, `... created_at DESC, id DESC`) |
| `apps/api/src/payments/discountAdjustment.ts` | improvement 06: the after-the-fact discount adjustment removed; capture posts the discounted fee (`settlementFeeFils`) | audits 06/09 and `9571805`: the adjustment kept, made atomic and once per capture event, called from checkout (`pay.ts`) | main's function, with a comment explaining the fit (below) |
| `CHANGELOG.md` | (nothing at that spot) | known-issues lines | main's |

### The negotiated discount, in detail

Both sides now run at checkout. The merged `capture.ts` charges the fee
settlement will charge (UI/UX) and records the pricing snapshot
`chargedMdrBps` and `negotiatedDiscountBps` on the capture event (main).
The adjustment then computes `fee - settlementFeeFils(amount, chargedMdrBps,
negotiatedDiscountBps)`, which is 0 for every new capture. It posts no
rebate and only marks the event `negotiatedDiscountAppliedFils = 0`. So a
discount is never taken twice. Older captures, made when capture charged
the full MDR, still get their rebate through main's legacy path.

`apps/api/src/payments/captureDiscount.test.ts` now checks this for a
paid payment link: the fee equals settlement's, no
`capture: negotiated discount adjustment` rows exist, and the event is
marked adjusted by 0.

## Found after the merge: the reporting role

Git merged it cleanly, but the code would have failed. Main's reporting
consumer (audit 10) checks, records and clears applied events in a new
table, `reporting_processed_events` (migration 0081). UI/UX's
least-privilege roles (`ops/db/service-roles.sql`, improvement 13) grant the
reporting role named tables only, and this one was missing. Under those
roles reporting would stop with "permission denied". Fixed by granting
`SELECT, INSERT, DELETE` on it; `scripts/serviceRoles.integration.test.ts`
now fails without the grant and passes with it.

## Migrations numbered twice

| Number | UI/UX | main |
|---|---|---|
| 0080 | `0080_platform_stats_bigint.sql` | `0080_platform_volume_bigint.sql` |
| 0081 | `0081_signup_limits_and_email_verified.sql` | `0081_reporting_processed_events.sql` |
| 0082 | | `0082_webhook_history_survives_endpoint_delete.sql` |

All filenames are kept. `db/migrate.ts` records applied migrations by
filename, so renaming a file would make databases that already applied it
run it again. The repo already has two files numbered 0073 for the same
reason. The two 0080 files run the same `ALTER ... TYPE BIGINT`, so whichever
runs second does nothing. Checked both ways:

- a fresh database applies all 79 migrations in order;
- a database that already had UI/UX's 0080 and 0081 applies only main's
  0080, 0081 and 0082.

A teammate's database from main will likewise apply only UI/UX's two.
**New migrations should start at 0083.**

## Verification

On a fresh database:

- `npm test`: 541 API, 40 reporting, web, money and scripts tests pass
- settlement Go tests and `go vet` pass
- `npm run typecheck`, both Vite builds and `npm run audit:prod` pass
- `npm run e2e:browser`: 11 of 11 pass against the merged API, including a
  paid payment link
