# 071: Checkout and the API accept an expired card

**Severity:** Low. Payments went through on cards whose expiry date had
passed. A real card network would decline them, so a merchant testing with
FilsPay got a wrong picture, and the checkout form also refused two-digit
years and accepted letters in the CVV.

## Where

- `apps/web/src/pages/checkout/CheckoutPage.tsx`: the Year field
  (`min={new Date().getFullYear()}`), the CVV field (`maxLength={4}` only)
  and `handleSubmit`, which sent the card without any check.
- `apps/api/src/payments/authorize.ts`, `authorizeTransaction`, used by
  `POST /v1/transactions` and by the hosted checkout's pay flow. Neither it
  nor `acquirer/simulator.ts` looked at the expiry date.

## Why it was wrong

The form only stopped years before this year, so 9/2026 passed in October
2026, and a two-digit year such as `30` was blocked by `min`. The CVV
field took any four characters, for every card brand. On the server,
`authorizeTransaction` went from the merchant check straight to
`acquirer.authorize(...)`, which approves any expiry.

## How to reproduce

In October 2026 pay a link with card 4242 4242 4242 4242, month 9, year
2026: the payment succeeded. With the API:
`POST /v1/transactions` with `expiryMonth: 12, expiryYear: 2025` returned
201.

## Fix

- API: `isCardExpired` in `authorize.ts`. A card is valid to the end of
  its expiry month, in Bahrain time; a two-digit year means 20YY. After the
  merchant check and before calling the acquirer, an expired card gets
  `422 { error: "card_expired" }`, saved on the idempotency key like a
  decline. The pay flow already passes the status through and hands the
  link back, so the link stays payable.
- Web: `apps/web/src/pages/checkout/cardChecks.ts` (`isCardExpired`,
  `normalizeExpiryYear`, `isCvvValid`, `cardProblem`). The checkout checks
  the card before sending it and shows a plain message. The Year field
  takes `30` and sends `2030`. The CVV must be 3 digits, or 4 for
  American Express (brand from `formatCardBrandHint`). `describePayFailure`
  explains a `422 card_expired` from the server.

## Test

- `apps/api/src/payments/cardExpiry.test.ts`: "POST /v1/transactions
  refuses an expired card with 422 card_expired" (got 201 before the fix)
  and "paying a payment link with an expired card is refused and the link
  stays payable" (got 200 before), plus a unit test of `isCardExpired`.
- `apps/web/src/pages/checkout/cardChecks.test.ts`: "an expired card is
  caught before it is sent", "a two-digit year means 20YY", "the CVV is
  digits only: 3, or 4 for American Express".
- `apps/web/src/pages/checkout/payError.test.ts`: "an expired card keeps
  the form and asks for another card".
