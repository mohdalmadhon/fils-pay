# 091: The demo data charges Alpha Retail 2.50% while its fee schedule says less

**Severity:** Low. On the demo, Alpha Retail's fees (ledger, transaction
history, settlement batch) disagreed with the fee schedule shown for the
same merchant, so the demo looked like it overcharged.

## Where

`db/seed/generate.ts` (`generate()`: the closed and peak-day settlement
batches, the first `transaction.captured` outbox event, the `fee_schedules`
inserts) and `db/seed/fixtures/transactions.ts` / `marchReconciliation.ts`
(`buildCaptureLedgerGroup`, `generateInstalmentCaptures` and the other
generators).

## Why it was wrong

Every seeded fee used the merchant's flat rate:

```ts
const fee = applyRateFils(capturedFils, mdrBps);   // mdrBps = fixture.mdrBps = 250
```

But the seed also gives Alpha Retail fee schedules:

```sql
($1, 225, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
($1, 245, '2026-03-01T00:00:00Z', '2026-08-15T00:00:00Z')
```

A real capture uses the rate in effect at that moment
(`apps/api/src/fees/feeSchedule.ts`: the newest `effective_from` that has
arrived, else `mdr_bps`). So Alpha Retail's August and September captures
should pay 225 bps and its March captures 245 bps, not 250. 54 of the seed's
capture ledger groups had the wrong fee (for example 1,250 fils on 50,000
instead of 1,125).

## How to reproduce

Seed, then for any Alpha Retail capture group compare the
`platform_fee_revenue` leg with `amount x 225 / 10000`. Before the fix it was
`amount x 250 / 10000`.

## Fix

The schedule rows now live in one constant, `SEED_FEE_SCHEDULES`, used both
to insert `fee_schedules` and to compute every seeded fee. `seedMdrBpsAt`
picks the rate for a capture's time with `effectiveMdrBpsAt` from
`apps/api/src/fees/settlementFee.ts` (the same rule as `feeSchedule.ts`,
falling back to `mdr_bps`). The generators take that function
(`mdrBpsAt`) instead of a flat `mdrBps`. Only Alpha Retail's numbers change:
Beta Digital's 180 bps schedule equals its own rate and its 165 bps cutover
is after all its seeded captures, and other merchants have no schedules.
Beta's schedule rows now get a fixed `created_at` instead of `now()`, which
does not change which row applies. Nothing in the seed's checks or the tests
pins Alpha Retail's exact fee totals; the ledger checksum changes but stays
deterministic.

The marketplace generator's discount formula and merchants with a
negotiated discount are not changed here (they have no fee schedules).

## Test

A new self-verify assertion, `capture-fees-follow-fee-schedules` in
`db/seed/selfVerify.ts`, checks every seeded capture group of a merchant
without a negotiated discount against the schedule in effect at the
capture (same SQL rule). It runs on every `npm run seed` and in
`db/seed/selfVerify.integration.test.ts` ("every REAL self-verify assertion
passes on the seed, and fails on a broken row"). Before the fix:
`54 of 1858 capture fee(s) differ, e.g. ... 1250 fils on 50000 at 225 bps`.
