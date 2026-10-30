# 070: Credit form shows the base MDR as the fee-reversal rate

**Severity:** Low. The operator was told one rate, and the server reversed
the fee at another, so the credit's fee part was not what they expected.

## Where

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`, the "Also reverse
the MDR on this amount" checkbox in the credit form.

## Why it was wrong

The label printed the merchant's base MDR:

```tsx
Also reverse the MDR on this amount ({(merchant.mdrBps / 100).toFixed(2)}%)
```

The server (`apps/api/src/admin/credits.ts`) reverses at the effective rate
today: `getEffectiveMdrBps` (the current fee schedule, falling back to the
base MDR), less the volume-tier bonus, after the negotiated discount. The
same page even shows the base MDR as "(fallback)" and the schedule rate
separately.

## How to reproduce

Give a merchant a base MDR of 2.50% and a fee schedule of 1.75%. Open the
credit form: the checkbox says 2.50%. Issue a 10.000 BD credit with fee
reversal: the reversal is 0.175 BD, not 0.250 BD.

## Fix

A helper, `feeReversalLabel` in
`apps/admin/src/pages/merchants/feeReversalLabel.ts`. With a current fee
schedule in the detail payload it shows that rate, saying it is before any
volume or negotiated discount. Without one it says "at the merchant's
current effective rate" and shows no number.

## Test

`apps/admin/src/pages/merchants/feeReversalLabel.test.ts`: "the
fee-reversal label uses the current fee schedule's rate, not the base MDR"
and "with no fee schedule it names the effective rate instead of a
number". Before the fix the label always showed the base MDR.
