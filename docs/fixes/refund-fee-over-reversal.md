# Fix report: refunds gave back more fee than was charged

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High (money). On a 100 BD capture with a 20 % negotiated discount, a full refund credited the merchant 2.500 BD of fee when they had paid 2.000 BD, so the platform lost 0.500 BD on every refunded discounted payment. |
| **Component** | `apps/api/src/payments/processRefund.ts` |
| **Reported** | "Can you refund more than what was actually charged?" |
| **Date** | 2026-10-29 |

## Summary

The refund **amount** was already capped correctly: captured − refunded, under
the row lock, from the concurrent-refunds fix. The **fee** a refund gives back was not.

At capture, `capture.ts` credits the full MDR to `platform_fee_revenue`. For a
merchant with `negotiated_discount_bps`, `applyCaptureDiscountAdjustment` then
**debits** the discount back out of it (*"capture: negotiated discount
adjustment"*). The fee the merchant really paid is credit − debit.

`processRefund` read the fee as **only the credits**. It reversed a share of
the gross fee, so the discount came back to the merchant a second time.

A second, smaller problem: each partial refund's fee share was rounded on its
own (`calculateRefundFee`, banker's rounding), and nothing capped the total.
The shares could add up to more than the fee. The new test forces this: a fee
of 3 fils, then two 1-fil refunds of a 2-fil capture, reversed **4**.

YA's note above the refund route warned about this: *"don't just wire it, the
helpers were written before the capture discount and tier existed"*.

## Where it was found

- `processRefund.ts`: `SUM(amount_fils) … WHERE account_id =
  'platform_fee_revenue' AND direction = 'credit'`.
- `packages/money` `calculateRefundFee`: *"No upper bound is asserted …
  duplicating the ceiling here would only create a second place for it to be
  wrong"*. So the ceiling had to live in the caller, and it didn't.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `refunds: reverse the fee net of the merchant's negotiated discount` | Fee charged = credits − debits on `platform_fee_revenue` for the transaction, leaving out earlier refunds' own reversals. Never negative. |
| 2 | `refunds: never reverse more fee in total than was charged` | Each reversal is capped at the fee not yet reversed. The refund that returns the last of the captured amount reverses exactly the remainder, so a fully refunded transaction always nets to zero fee. |
| 3 | `db: report refunds that reversed more fee than was charged` | `db/reports/refund-fee-over-reversal.sql`, read-only. Lists every transaction whose refunds credited back more than its net fee, with the excess. |
| 4 | `test: refunds reverse the net fee and never more than was charged` | `refundFeeReversal.test.ts`, 4 tests. |
| 5 | `docs: refund fee over-reversal fix report` | This report. |

`packages/money` (frozen, audited) is not modified.

## Verification

- `refundFeeReversal.test.ts`: 4/4 pass. Against the old code, 3 fail:
  - Full refund: expected 2000, reversed 2500.
  - Three partial refunds: expected 1667, reversed 2499.
  - Forced rounding: expected 3, reversed 4.

  The no-discount case passes both before and after.
- Existing refund tests (`processRefund*`, `refundValidation`, `refundState`,
  `initiateMerchantRefund`): 39/39 pass.

## Deploying

No migration. The merchant refund route (`POST /v1/merchants/:id/refunds`) is
still a `501` stub, so today the only refunds are ones run through the
internal paths. Run `db/reports/refund-fee-over-reversal.sql` to see whether
any past refunds over-credited a merchant.

## Related, not changed here

- The capture discount is applied by the transactions route after the capture
  commits, in its own transaction. If that step fails, the capture stands
  with no discount. Refunds stay correct either way, because they now read
  whatever the ledger actually holds.
