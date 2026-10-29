# Fix report: concurrent refunds pay out twice

| | |
|---|---|
| **Status** | Fixed (uncommitted in the working tree) |
| **Severity** | Critical. Money leaves the platform more than once for the same payment, and the records hide it. |
| **Component** | `apps/api/src/payments/processRefund.ts` (the refund engine behind `initiateMerchantRefund` and the future `POST /v1/refunds`) |
| **Reported** | Two refund requests came in at the same time, both went through, and money was lost. Normal payments (captures) don't have this problem. |
| **Date** | 2026-10-29 |

## Summary

`processRefund` validated a refund and recorded it in **two separate
database transactions** with the acquirer call in between, and it **never
locked the payment row**. Two refunds for the same payment that arrived
together (different idempotency keys: two agents, a retry with a fresh key,
a script) both read `refunded_fils = 0`, both passed validation, both told
the acquirer to send the money back, and both wrote
`refunded_fils = 0 + amount`. The second write overwrote the first, so the
counter showed one refund while two went out.

Capture doesn't have the problem because `captureTransaction` takes
`SELECT ... FOR UPDATE` on the transaction **before** validating and holds it
through the acquirer call to `COMMIT`. Refunds skipped this. Its own comment
says "lock is held across the call on purpose".

The fix gives refunds the same shape as capture: one transaction that
locks, validates, calls the acquirer and records the refund, with the lock
held the whole time.

## Why refunds broke and payments didn't

| | Capture (`capture.ts`) | Refund before the fix (`processRefund.ts`) |
|---|---|---|
| Row lock | `SELECT ... FOR UPDATE` first | none |
| Transactions | one: lock → validate → acquirer → journal → commit | **two**: validate+commit, then acquirer with nothing held, then journal |
| New total written as | value read under the lock + amount | **stale value read earlier** + amount, so it overwrites other refunds |
| Concurrent second request | waits on the lock, then sees the new state | sees the same old state and passes |

## Where it was found

- `apps/api/src/payments/processRefund.ts`:
  - Phase 1 (`withTransaction`): `SELECT ... FROM transactions WHERE id = $1`,
    with no `FOR UPDATE` and no merchant filter. It validated and then
    committed.
  - Phase 2: `acquirer.refund(...)` called with no lock held.
  - Phase 3 (new `withTransaction`): `UPDATE transactions SET refunded_fils = $2`,
    where `$2` is the value read in phase 1 plus this refund.
- Inline notes show it had been noticed. In `idempotency.ts`, MK:
  "processRefund commits the claim before the acquirer call, so in_progress
  can legitimately be seen there". YA, in the `refunds.ts` route stub: "don't
  just wire it, the helpers were written before the capture discount and tier
  existed". The docs (`ONBOARDING.md`, `.cursorrules`) call the helper
  "complete, tested". Its tests only ever ran one refund at a time.

**Found while fixing it, same file:**

1. **Every refund failed.** Migration `0070_refund_reason_default.sql` added
   `CHECK (reason IS NOT NULL)`, but the insert passed `reason ?? null`. Any
   refund without a reason was rejected by the database. That is why 11
   refund tests were failing before this change.
2. **Refunds could exceed what was captured.** The ceiling was
   `amount_fils - refunded_fils` (the *authorized* amount), not
   `captured_fils - refunded_fils`. On a 10,000-fils authorization with only
   4,000 captured, a 10,000 refund was accepted. A blank amount ("refund
   everything") also refunded the authorized amount.
3. **No merchant scoping.** The transaction was looked up by id alone, so a
   caller could refund another merchant's payment. Capture filters by
   `merchant_id`; refunds didn't.

## Reproduction

New test file `apps/api/src/payments/processRefundConcurrency.test.ts`. It
uses an acquirer that waits 75 ms (so requests really overlap) and counts the
money it sends out. Results **before** the fix (with only the `reason` bug
patched, so refunds could run at all):

| Test | Expected | Before fix |
|---|---|---|
| 2 simultaneous full refunds of a 10,000-fils payment | one 200, one refused; 10,000 out | **both 200; 20,000 out** |
| 5 simultaneous 3,000 refunds of a 10,000 payment | 3 succeed; 9,000 out; `refunded_fils` 9,000 | **all 5 succeed; 15,000 out; `refunded_fils` says 3,000** |
| Same idempotency key twice at once (double-click) | one refund; second replays it | second got `409 request_in_progress` |
| 10,000 refund when only 4,000 was captured | 422, ceiling 4,000 | **200, 10,000 out** |
| Refund another merchant's payment | 404, acquirer never called | **200, refunded** |

## Fix

`apps/api/src/payments/processRefund.ts`, `processRefund` rewritten as one
`withTransaction`, in the same order as `captureTransaction`:

1. Claim the idempotency key. A concurrent request with the same key blocks
   on the unique index, then replays the stored response.
2. `SELECT ... FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
   locking and scoping first.
3. Validate against `captured_fils - refunded_fils`, read under the lock.
4. Read the fee charged at capture from the ledger (unchanged).
5. Call the acquirer **with the lock still held**.
6. Insert the refund (`reason` defaults to `'unspecified'`, the column
   default from 0070), update `refunded_fils` from the locked value, post the
   ledger reversal, the timeline event and `refund.succeeded`, then complete
   the idempotency key. Commit.

A second refund for the same payment now waits at step 2 until the first
commits, then validates against the new total. Decline and acquirer-error
handling, response bodies, ledger legs, events and outbox payloads are all
unchanged.

**Trade-off:** the payment row stays locked for the length of the acquirer
call. This is the same, deliberate choice capture already makes. Refunds of
*different* payments are not affected.

New test file `processRefundConcurrency.test.ts`: the five tests above.

## Verification

- New tests: 5/5 pass after the fix, on three runs in a row. All 5 failed
  before.
- Existing refund tests (`processRefund.test.ts`,
  `initiateMerchantRefund.test.ts`, `refundValidation.test.ts`,
  `refundState.test.ts`): all pass, unchanged. Several of these were failing
  before because of the `reason` constraint.
- `tsc --noEmit` is clean for `apps/api`.
- Full `apps/api` suite: **374/375** (was 358/370 with 12 failures). The one
  remaining failure is the webhook backoff/exhaustion test, which was already
  failing and is unrelated to refunds.

## Deploying and checking past damage

No migration is needed; restart the API. To find payments that were
refunded more than once, or beyond what was captured, run:

```sql
SELECT t.id, t.merchant_id, t.captured_fils, t.refunded_fils,
       SUM(r.amount_fils) AS refunds_sent, COUNT(*) AS refund_count
  FROM transactions t
  JOIN refunds r ON r.transaction_id = t.id AND r.status = 'succeeded'
 GROUP BY t.id
HAVING SUM(r.amount_fils) <> t.refunded_fils
    OR SUM(r.amount_fils) > t.captured_fils;
```

Each row is money that went out twice, or beyond what was captured. It needs
recovering from the merchant or writing off with finance.

## Related, not changed here

- **`initiateMerchantRefund.ts` can still refund another merchant's payment.**
  It looks the transaction up by id and passes **that transaction's own**
  `merchant_id` into `processRefund`, so the new merchant scoping doesn't
  protect this path. It must pass the authenticated merchant instead. This
  should be fixed before the refund route is wired.
- Fee reversal is rounded separately for each partial refund
  (`calculateRefundFee`), so several partials can reverse slightly more fee
  than was charged.
- Refunds still don't reach settlement, `refund.succeeded` isn't in the
  webhook dispatcher's list, and `POST /v1/refunds` still returns 501.
