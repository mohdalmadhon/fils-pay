# 003: A checkout attempt that errors leaves the payment link stuck as "reserved"

**Severity:** Medium. Anyone holding a link could block real buyers (and the
merchant's cancel) with one bad request a minute.

## Where

`apps/api/src/paymentLinks/pay.ts`, `payPaymentLink`, steps 2 (authorize)
and 3 (capture and finalize). The public route is
`POST /v1/payment-links/:token/pay`.

## Why it was wrong

Step 1 commits the link as `reserved` with this attempt's token. The
reservation was handed back only when authorize *returned* a non-201 status.
When authorize or the capture transaction *threw* (a body like
`{"card":{}}` crashes the simulator on `card.pan.endsWith`, a reused
idempotency key throws 422, a database or acquirer error), nothing released
it. The link stayed `reserved` until the reservation timeout (60 s by
default):

- every real buyer got `409 payment_link_processing`;
- the merchant's cancel only matches `status = 'active'`, so it answered
  `409 not_cancelable`;
- the route needs no sign-in, so one bad request a minute kept the link
  blocked for as long as someone wanted.

## How to reproduce

`POST /v1/payment-links/<token>/pay` with `{"card":{}}`: 500, and the link
is `reserved`. A valid payment straight after gets
`409 payment_link_processing`.

## Fix

Both steps now catch any error, release the reservation (still checking the
token, so a slow attempt never releases another buyer's reservation) and
rethrow the original error. A failure to release is logged and does not
replace the original error. Rejecting a malformed card with a 400 before
any of this runs is bug 008.

## Test

`apps/api/src/paymentLinks/payFailures.test.ts`: "an attempt that throws
hands the link back instead of leaving it reserved". Failed with
`actual: 'reserved'` before the fix.
