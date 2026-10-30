# 014: A refund leaves the merchant's cached payable balance too high

**Severity:** Medium. Ops saw a wrong payable balance for every merchant
that had refunded anything.

## Where

`apps/api/src/payments/processRefund.ts`, `processRefund`, right after the
refund's ledger legs.

## Why it was wrong

A refund posts two pairs of ledger legs on `merchant_payable`:

- a debit of the refunded amount ("refund: gross");
- a credit of the fee given back ("refund: MDR fee reversal").

`merchant_balances.cached_payable_fils` is meant to follow every payable
movement, and capture, discount adjustments, credits and imports all call
`applyPayableCacheDelta`. Refunds did not, so after a refund the cache stayed
higher than the ledger by (refund − fee reversed) until someone ran
`rebuild-balances`. The admin merchant page
(`apps/api/src/admin/merchants.ts`) shows that cached figure.

## How to reproduce

Capture 10,000 fils at 250 bps (payable 9,750), refund 4,000 (fee reversed
100). Before the fix: cache 9,750, ledger 5,850.

## Fix

`processRefund` calls the existing
`applyPayableCacheDelta(client, merchant, feeReversed − refund)` in the same
transaction as the legs. The helper itself, and when it writes, are
unchanged (that timing belongs to the capacity work).

## Test

`apps/api/src/routes/merchantRefunds.test.ts`: "a refund moves the cached
payable balance with the ledger". Got 9750 against 5850 before the fix.
