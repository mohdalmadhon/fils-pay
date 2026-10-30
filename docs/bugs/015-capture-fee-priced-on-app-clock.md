# 015: Capture and settlement can charge different fees when a fee schedule starts mid-capture

**Severity:** Low. It needs a fee change to land during a capture (for
example a lock wait across midnight), but then the fee charged at capture
and the fee settlement charges differ, and the difference stays in the
payable ledger.

## Where

`apps/api/src/payments/capture.ts`, `captureTransactionWithClient`, where
the MDR rate is looked up.

## Why it was wrong

```ts
const effectiveMdrBps = await getEffectiveMdrBps(client, input.merchantId, new Date(), merchant.mdr_bps);
```

`new Date()` is the API server's clock at that line, which can be well after
the database transaction began (waiting for the row lock, etc.). The capture
event and ledger legs are dated by the column default `now()`, which in
Postgres is the transaction's start. Settlement prices each event at its
`occurred_at` (`EffectiveMdrBpsAt(schedules, e.occurredAt, …)`). A schedule
whose `effective_from` falls between those two instants was applied at
capture but not at settlement.

## How to reproduce

Open a transaction, add a schedule that starts 300 ms later, wait 600 ms,
capture inside that transaction. Before the fix: the capture charged the new
rate while its event is dated before it.

## Fix

`now()` is read together with the merchant row (no extra query) and the
schedule is resolved at that instant, the same one the event carries.

## Test

`apps/api/src/payments/captureFeeClock.test.ts`: "a fee schedule that
starts between the transaction's start and the app clock does not apply".
Charged 100 bps instead of 250 before the fix.
