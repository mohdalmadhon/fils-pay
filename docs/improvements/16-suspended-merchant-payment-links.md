# 16: A suspended merchant's payment link still looked payable

| | |
|---|---|
| **Type** | Customer-facing bug |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `apps/api/src/paymentLinks/read.ts` (`getPublicPaymentLink`) and `paymentLinks/status.ts` (`derivePublicStatus`) ignored `merchants.status`. `apps/web/src/pages/checkout/CheckoutPage.tsx` (`handleSubmit`) had no case for `409 merchant_unavailable`. |

## What was wrong

The security work made paying refuse a suspended or closed merchant's link
with `409 merchant_unavailable` (`pay.ts`). The public read
`GET /v1/payment-links/:token` was not changed and still answered `"active"`.
For the customer this meant:

1. The checkout page showed the amount and the card form.
2. They typed their card and pressed Pay.
3. The API refused it. The page sent every unrecognised 409 to the
   "link in flight" message: *"Someone is paying this link right now. Wait a
   moment, then refresh the page."*
4. Refreshing showed the form again, so the loop never ended.

No money moved. The page was still wrong, and it led the customer to keep
retrying.

## Fix

| # | Commit |
|---|---|
| 1 | `test: a suspended merchant's payment link reads as unavailable`: `routes/paymentLinkSuspendedMerchant.test.ts`. 3 of its 4 cases fail before the fix. |
| 2 | `payment-links: an unpaid link of a suspended merchant reads as unavailable`: `derivePublicStatus` takes `merchantStatus`, and `read.ts` selects `m.status` |
| 3 | `web: checkout says when a merchant can't take payments`: a closed "can't take payments right now" state instead of the form |
| 4 | `web: a refused payment for a suspended merchant ends the checkout`: the error mapping moves to a pure `describePayFailure` (`pages/checkout/payError.ts`, with tests), and `merchant_unavailable` now ends the checkout |
| 5 | `docs: improvement 16, suspended merchant payment links` |

The rules for the new public status, `unavailable`:

- An unpaid link (active, reserved or expired) of a merchant whose status
  is not `active` shows as `unavailable`.
- `paid` and `canceled` keep their status. A paid link is the customer's
  receipt, and it still says paid after a suspension.
- Reactivating the merchant makes the link `active` again, and it can be
  paid.
- The response says nothing about why. It doesn't reveal "suspended" or
  "closed" to the public, the same choice `pay.ts` made.

API clients that switch over the public status need to handle
`unavailable`. The only client in the repo is the checkout page.

## Verified

- `paymentLinkSuspendedMerchant.test.ts` 4/4. Together with
  `paymentLinks.test.ts`, `paymentLinksExpiry.test.ts` and `status.test.ts`,
  that is 22/22.
- `payError.test.ts` (2): `merchant_unavailable` ends the checkout and doesn't
  mention refresh. The other outcomes (402, 502, the three other 409s, 410,
  and the fallback) are unchanged. Web total: 10/10.
- `tsc` and `vite build` pass for the web app.
