# 08: Refunds are live, and the helper behind them had a cross-merchant hole

| | |
|---|---|
| **Type** | Missing feature, plus a security bug found while wiring it |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `POST /v1/refunds` returned 501 (`apps/api/src/routes/refunds.ts`, FP-212). The bug: `apps/api/src/refunds/initiateMerchantRefund.ts:62-73`. |

## What was wrong

**1. Refunds weren't wired.** The route was a 501 stub. Its helpers
(`initiateMerchantRefund`, `processRefund`) were written and tested, but nothing
called them. A note warned against wiring them as they were, because they
predated the capture discount and the volume tier.

**2. The helper let any merchant refund any merchant's payment.**
`initiateMerchantRefund` looked the transaction up by id alone, then passed
**the transaction's own merchant** to `processRefund`:

```ts
const txn = (await pool.query(`SELECT id, merchant_id FROM transactions WHERE id = $1`, ...)).rows[0];
return processRefund(pool, acquirer, { transactionId: txn.id, merchantId: txn.merchant_id, ... });
```

`processRefund` does scope its lookup to the merchant it is given
(`WHERE id = $1 AND merchant_id = $2`), but that merchant was always the right
one for the transaction, so the check never failed. A test showed merchant A
refunding merchant B's captured payment: 200, money moved, and the refund's
idempotency key landed in B's namespace. Wiring the route would have exposed
it to every merchant.

## Fix

| # | Commit |
|---|---|
| 1 | `test: a merchant can't refund another merchant's transaction` (fails before: 200) |
| 2 | `refunds: refund only the caller's own transactions` |
| 3 | `test: the merchant refund route` (7 route cases) |
| 4 | `refunds: wire POST /v1/merchants/:merchantId/refunds` |
| 5 | `docs: improvement 08, refunds` |

### The endpoint

```
POST /v1/merchants/:merchantId/refunds
Idempotency-Key: <required>
{ "transactionId": "<uuid>", "amountFils": 1250, "reason": "item returned" }
```

`amountFils` is optional (omit it for a full refund). Responses are those of
`processRefund`:

| Status | Meaning |
|---|---|
| 200 | refunded |
| 400 | missing or invalid input, or no `Idempotency-Key` |
| 402 | declined |
| 403 | another merchant's path, the support role, a view-only admin session, or refunds on hold for this merchant |
| 404 | not the caller's transaction |
| 409 / 422 | not refundable, or the amount is too large |
| 502 | acquirer unavailable; retry with the same key |

Safety, point by point against the draft that used to sit in the stub:

- The merchant comes only from the path, checked against the caller. A
  `merchantId` in the body is ignored (tested).
- The body is mapped field by field: `transactionId` must be a UUID,
  `amountFils` an integer, `reason` at most 500 characters.
- The client's `Idempotency-Key` is required. A retry replays the first answer
  instead of refunding twice (tested).
- Owner and finance only; API keys are owner-issued.

### The note about discount and tier

Checked: the fee given back is read from the ledger as what was actually
charged (`processRefund`, net of any discount, either kind), so neither the
discount nor the volume tier is re-derived. The earlier fee-reversal fixes
(`docs/fixes/refund-fee-over-reversal.md`, `concurrent-refunds.md`) apply
unchanged.

### Kept as they were

- `POST /v1/refunds` stays a 501 stub, now pointing to the real route.
  `AGENTS.md` asks that stubs are kept, and `transactions.test.ts` asserts it.
- `refund.succeeded` is not added to the webhook events. `AGENTS.md` says it
  ships in v1.9.
- The dashboard has no refund button yet. The API is ready for one.

## Verified

`merchantRefunds.test.ts` (7), `refundScope.test.ts` (2),
`initiateMerchantRefund.test.ts`, `processRefund*.test.ts` and
`transactions.test.ts` pass.
