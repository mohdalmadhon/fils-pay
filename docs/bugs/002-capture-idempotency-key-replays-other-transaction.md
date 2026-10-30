# 002: Reusing a capture Idempotency-Key on another transaction replays the first one

**Severity:** High. The second payment is never captured, so its money is
never collected, while the merchant gets a 200 that looks like success.

## Where

`apps/api/src/payments/capture.ts`, `captureTransactionWithClient`: the
request fingerprint passed to `claimIdempotencyKey`.

## Why it was wrong

Idempotency keys are stored per merchant and endpoint
(`transactions.capture`), not per transaction. The fingerprint that decides
"same request" or "different request" was only the amount:

```ts
const requestHash = hashRequest({ amountFils: input.amountFils ?? null });
```

So capturing transaction B with the key already used for transaction A (and
the same amount, or no amount) matched A's stored request and replayed A's
saved response: `200` with A's id. B stayed `authorized`. The refund flow
already includes the transaction id in its fingerprint; capture did not. A
test comment ("Claude says that case can't happen because keys are per
transaction") had assumed the wrong scope.

## How to reproduce

Authorize T1 and T2. Capture T1 with `Idempotency-Key: K`, then capture T2
with the same key. Before the fix: `200` with T1's body; T2 still
`authorized`.

## Fix

The transaction id is part of the fingerprint, so the second call is
refused with `422 idempotency_key_reused`, which is what the API docs
promise for a reused key with a different request. Keys saved before this
change carry the old fingerprint, so a retry of one of those within its
24-hour window gets a 422 instead of a replay; the capture itself had
already happened, so nothing is charged twice.

## Test

`apps/api/src/routes/transactions.test.ts`: "capture with a reused
idempotency key on a DIFFERENT transaction is rejected, not replayed".
Failed with `actual: 200` before the fix.
