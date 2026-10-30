# 05: View-only users and admins could capture and void

| | |
|---|---|
| **Severity** | High |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/routes/transactions.ts`, `routes/refunds.ts`, `auth/requireMerchantAuth.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

"View as merchant" is meant to be read-only for support and finance admins
(ADMIN.md). It works by giving the grant the merchant-plane `support` role and
relying on every write route to require owner or finance. Two money-moving
routes had no role check at all:

- `POST /v1/transactions/:id/capture`
- `POST /v1/transactions/:id/void`

A comment on capture said impersonation was "read-only, enforced in
requireMerchantAuth". It isn't; `requireMerchantAuth` only authenticates.

## Attack

- A support admin opens "view as merchant" and captures or voids that
  merchant's authorizations.
- A merchant's own `support` user does the same.
- The write is recorded as `merchant_session` with the grant id, so the
  merchant's audit trail doesn't show an admin did it.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: capture and void need the owner or finance role` | 4 of 6 cases fail before the fix. |
| 2 | `transactions: require owner or finance to capture or void` | Adds `requireMerchantRole("owner", "finance")` to both. |
| 3 | `refunds: gate the stub to owner or finance and drop the unsafe draft` | The 501 stub is gated now. The handler drafted in its comment is replaced with a warning (see below). |
| 4 | `auth: a view-only impersonation grant can never write` | `requireMerchantWriterActor` refuses `admin_impersonation` unless the role is owner (super_admin). A backstop for any future route that forgets its gate. |
| 5 | `docs: cyper 05, capture and void roles` | This file. |

### The refund draft

`routes/refunds.ts` carried a drafted handler, waiting to be wired:

```ts
initiateMerchantRefund(app.db, app.acquirer, {
  merchantId: request.merchantAuth.merchantId,
  ...(request.body as any),            // a body merchantId overrides the line above
  idempotencyKey: crypto.randomUUID(), // a retry refunds twice
});
```

Wiring it as written would have allowed refunds against any merchant's
transactions, and double refunds on every retry. The comment now says what
wiring must do instead.

## Verified

`transactionWriteRoles.test.ts` (6), `requireMerchantWriterActor.test.ts` (3),
`transactions.test.ts`, `adminRoleChecks.test.ts`, `admin.test.ts` and
`paymentLinks.test.ts` pass.

## Open

- **Should finance be allowed to void?** An old TODO asked this. Capture and
  void now match the other write routes (owner and finance). That is a product
  decision.
- **Audit attribution for super_admin writes.** A super_admin's impersonated
  write is still stored as `merchant_session` with the grant id. Fixing it
  means a migration adding `admin_impersonation` to the `created_by_type` and
  `actor_type` CHECK constraints on `payment_links`, `webhook_endpoints` and
  `transaction_events`.
