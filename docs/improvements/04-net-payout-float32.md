# 04: Large settlement batches paid out the wrong amount (float32)

| | |
|---|---|
| **Type** | Money bug (new finding, made while fixing improvement 02) |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `apps/settlement/internal/settlement/payable.go:10-13`, `NetPayableFils`, used by `CloseBatch` (`batch.go:219`) for every batch's net payout and by the MDR preview (`recalculate_mdr.go:107`). Also `payout_estimate.go`, `EstimateMonthlyPayout`. |

## What was wrong

```go
netBD := float32(grossFils)/1000 - float32(feeFils)/1000
return money.Fils(math.Round(float64(netBD) * 1000))
```

The net payout was computed by turning integer fils into `float32` BD values,
subtracting, and rounding back. `float32` holds about 7 significant digits.
From roughly 16,384 BD the gap between representable values is bigger than
a fil, so the net comes out wrong:

| Gross | Fee | Old net | Correct net | Error |
|---|---|---|---|---|
| 47.333 BD | 1.065 BD | 46.268 | 46.268 | 0 |
| 123,456.789 BD | 3,086.420 BD | 120,370.367 | 120,370.369 | **−2 fils** |
| 9,007,199.254 BD | 0 | 9,007,199.000 | 9,007,199.254 | **−254 fils** |

The payout ledger legs and the disbursement use this figure, so the merchant
was paid the wrong amount, and gross − fee − payout no longer cancelled in
`merchant_payable`. `CLAUDE.md` itself says Go uses `float32` only for
display and `int64` "for anything that feeds back into calculations"; this
fed every payout. Small batches (like the end-to-end check's 47.333 BD) were
exact, which is why it went unnoticed.

`EstimateMonthlyPayout` had the same pattern (summing nets into a `float32`,
exact only up to 16,777,216 fils). It is monitoring-only with no callers
yet, but returns money, so it was fixed too (the same fix solved problem 009
made to the lifetime estimate).

## Fix

`NetPayableFils` is now `grossFils - feeFils`. `EstimateMonthlyPayout` sums
`money.Fils` and returns `money.Fils`. `apps/settlement/internal/money`
(frozen) was not touched.

| # | Commit |
|---|---|
| 1 | `test(settlement): net payout is gross minus fee, exactly` (fails before: −2 and −254 fils) |
| 2 | `settlement: compute net payout in integer fils, not float32` |
| 3 | `settlement: sum the 30-day payout estimate in integer fils` |
| 4 | `test(settlement): a large batch closes with an exact net payout` (CloseBatch end to end; fails on the old code: 120,370,367 vs 120,370,369) |
| 5 | `docs: improvement 04, float32 net payout` |

## Verified

`go test ./...` in `apps/settlement` against Postgres: all packages pass.

## For finance

Batches already closed with a gross above about 16,384 BD may have a net that
is off by a few fils. To find them:

```sql
SELECT id, merchant_id, batch_date, gross_fils, fee_fils, net_payout_fils,
       gross_fils - fee_fils - net_payout_fils AS diff_fils
  FROM settlement_batches
 WHERE status IN ('closed', 'paid') AND net_payout_fils <> gross_fils - fee_fils;
```

Any correction is a finance-approved adjustment, not a rewrite of the batch
(ADR 0008).
