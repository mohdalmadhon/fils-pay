# 065: Checkout tells the customer to "try again" when the merchant isn't approved

**Severity:** Medium. A customer paying a business that is not approved yet
was told to try again and kept the card form, so they retried a payment
that can never work.

## Where

`apps/web/src/pages/checkout/payError.ts`, `describePayFailure`.

## Why it was wrong

When the merchant's onboarding is not `approved`,
`apps/api/src/payments/authorize.ts` answers
`403 { error: "merchant_not_approved" }`. `describePayFailure` had no case
for 403, so it reached the last line:

```ts
return { kind: "declined", message: body.message ?? "The payment didn't go through. Try again.", countsAsDecline: false };
```

`declined` keeps the card form on screen.

## How to reproduce

Create a payment link for a merchant whose onboarding is still
`under_review`, open it and pay. Before the fix the page said "The payment
didn't go through. Try again." and the form stayed.

## Fix

A `403 merchant_not_approved` is now `terminal` (the form goes away) with
the message "This business can't accept payments yet. No payment was
taken."

## Test

`apps/web/src/pages/checkout/payError.test.ts`: "a merchant that isn't
approved yet ends the checkout with a clear message". Before the fix it got
`kind: 'declined'`.
