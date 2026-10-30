# 005: An authorization can still be captured after its 7-day hold has lapsed

**Severity:** Medium. A merchant could take money on a promise to pay that
had already lapsed; the card scheme would refuse or charge it back.

## Where

`apps/api/src/payments/capture.ts`, `captureTransactionWithClient`.

## Why it was wrong

`authorize.ts` places a hold for 7 days ("scheme rule for card-not-present")
and `scripts/expire_holds.ts` deletes holds still active after
`expires_at`. Capture never looked at either: it only checked
`status IN ('authorized', 'partially_captured')`. An authorization from
weeks ago was captured, journaled and paid out as if it were fresh.

## How to reproduce

Authorize, move the hold's `expires_at` and the transaction's
`occurred_at` 8 days back, run the expire SQL, then capture. Before the
fix: `200 captured`.

## Fix

The locked read of the transaction also works out, on the database clock,
whether the authorization has lapsed: the latest hold's `expires_at` if a
hold row exists, otherwise 7 days after the authorization (the janitor
deletes lapsed holds, so a missing row cannot mean "still valid"). A lapsed
one gets `409 authorization_expired` and nothing is captured.

## Test

`apps/api/src/routes/transactions.test.ts`: "an authorization past its
7-day hold can no longer be captured". Got 200 before the fix.
