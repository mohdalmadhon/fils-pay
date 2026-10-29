# 011 — Merchant A can cancel merchant B's payment link

Recorded: 2026-10-29.

Status: implemented and verified locally in a disposable database.
No production link was canceled, restored, or otherwise changed.

## Reported problem and root cause

The user reported canceling merchant B's payment link from merchant A's
dashboard. The cancellation route authenticated the caller and checked
that the path's merchant ID matched the authenticated merchant. It then
called a helper with only the link UUID.

That helper executed `UPDATE payment_links ... WHERE id = $1 AND
status = 'active'`. It did not constrain `merchant_id`. An authorized user
of A could therefore request:

```text
DELETE /v1/merchants/<A>/payment-links/<B-link-id>
```

The merchant-path check passed because the path contained A, and the update
canceled B's active link. Knowing the UUID was enough; UUIDs do not prove
authorization. The follow-up error query also used only the UUID, allowing
the endpoint to reveal another merchant's link status if it was not active.

This is a missing resource-ownership check at the database boundary.
The normal detail page fetches a merchant-scoped list and searches it for
the selected ID. That frontend filtering does not authorize a server write.
The exact browser steps or deployed frontend state behind the user's
report were not available; authenticated HTTP requests directly exercise
the confirmed vulnerable route.

## Fix and affected lines

| Location | Change |
|---|---|
| [cancel.ts:8](../../apps/api/src/paymentLinks/cancel.ts#L8), lines 8–18 | Require `merchantId` in the helper input and add `merchant_id = $2` to the atomic active-link update |
| [cancel.ts:24](../../apps/api/src/paymentLinks/cancel.ts#L24), lines 24–28 | Scope the fallback status lookup to the same merchant so foreign links look missing in every state |
| [paymentLinks.ts:50](../../apps/api/src/routes/paymentLinks.ts#L50), lines 50–55 | Clarify that the path check and resource ownership are separate requirements |
| [paymentLinks.ts:105](../../apps/api/src/routes/paymentLinks.ts#L105), lines 105–108 | Supply `request.merchantAuth.merchantId`, derived from authentication, to cancellation |
| [Architecture](../ARCHITECTURE.md#security), [runbook](../RUNBOOK.md#payment-link-cancellation-ownership), and [index](README.md) | Record the ownership contract, activation, and this reference trail |

Both queries are parameterized. Ownership is enforced in the update itself,
rather than through a separate preflight read that could drift from the
mutation. A foreign or nonexistent link returns `404 payment_link_not_found`.
An owned active link still returns 204; an owned paid, reserved, or canceled
link still returns `409 not_cancelable`. The existing path mismatch 403,
authentication, and owner/finance role rules remain intact.

No schema change, frontend workaround, money-package change, or change to
public checkout/payment behavior is required.

## References and earlier mentions

The pre-fix code remains available in baseline commit `373b1f3` using
`git show 373b1f3:<path>`.

| Reference | Evidence and limits |
|---|---|
| [Cancellation helper](../../apps/api/src/paymentLinks/cancel.ts), baseline lines 8–30 | Mutation and status query both use an unscoped link ID |
| [Merchant route](../../apps/api/src/routes/paymentLinks.ts), baseline lines 50–55 and 100–116 | An inline comment claims the path check establishes ownership; the following comment already questions whether it checks the link's merchant. The helper receives no merchant ID. |
| [Locked cancellation tests](../../apps/api/src/routes/paymentLinks.test.ts#L242) | An inline note explicitly says there is no cross-merchant cancellation case. Existing cases cover own cancellation, nonexistent ID, and paid-state conflict. Tests remain unchanged. |
| [Merchant auth](../../apps/api/src/auth/requireMerchantAuth.ts) | Resolves authenticated merchant identity from a session or API key; enforces session roles on this write route |
| [Frontend client](../../apps/web/src/api/paymentLinks.ts#L64) | Already promises 404 for a link outside the merchant; the backend now meets that contract |
| [Detail page](../../apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx#L43) | Loads a scoped list, finds the selected ID, and calls cancellation with merchant ID and link ID; frontend visibility is not a server ownership check |
| [Scoped list query](../../apps/api/src/paymentLinks/query.ts) | Already filters links by merchant; cancellation was inconsistent with this boundary |
| [Payment-link schema](../../db/migrations/0020_payment_links.sql) | Stores `merchant_id` and cancellation time, plus creation attribution. The row does not store the canceling actor. |
| [Architecture security rule](../ARCHITECTURE.md#security) | Requires merchant-scoped queries to derive merchant identity from authenticated context |

Architecture, handover, ADRs, and changelog were reviewed. No documented
decision authorizes merchants to cancel other merchants' links, and no
separate incident note for this cancellation bug was found. The May
duplicate-capture incident concerns a different payment-link operation.

## Verification

A temporary TypeScript harness used the real Fastify application, real
authenticated sessions/API keys, and real PostgreSQL queries. Its disposable
database used actual migrations through 0053, the schema needed for this
operation. The unrelated shared migration-0054 failure was not edited or
bypassed in the shared database. The harness and disposable database were
removed after verification.

Passed **35 HTTP checks**, plus direct helper and row-integrity assertions:

- Merchant A's owner session, finance session, and API key each receive 404
  for B's active, reserved, paid, and canceled links. The complete foreign
  row stays unchanged after each rejected request.
- Direct helper calls with A and B's link IDs return `not_found` for all
  four states, verifying the protection is in the helper too.
- Each authorized actor can cancel its own active link. Status becomes
  canceled, `canceled_at` is set, and a retry returns 409.
- Owned reserved/paid/canceled links retain the existing 409 behavior.
- Missing IDs return 404; mismatched path merchants return 403; anonymous
  requests return 401; support-role cancellation returns 403.
- A body-supplied merchant ID cannot override the authenticated scope.
- Concurrent requests by A and B against B's active link return 404 to A
  and 204 to B. No ledger entries are created by these checks.

API TypeScript compilation passed. The required full suites were run with
the shared local PostgreSQL database:

- `npm test` retains existing failures, including the old fee-display
  backfill expectation and missing tables such as `adjustment_imports`,
  `credit_requests`, and `reporting_saved_filters`. Existing payment-link
  route checks, including the cancellation happy-path/missing/paid case,
  reported no failures.
- `go test ./...` retains the two balance-refresh and four finalized-MDR
  expectation failures documented in records [003](003-admin-balance-rebuild-source.md)
  and [004](004-mdr-finalized-batches.md). Config, internal API, money,
  scheduler, and splits passed. No Go code changed in this fix.
- Documentation file references and `git diff --check` passed.

The full suites are not green. Regression-locked test files remain unchanged.

## Activation and historical limits

Deploy/restart API instances to activate the fix; no migration is needed.
Existing canceled links are not automatically reactivated or replaced.

Investigate the reported link ID and retained request/session logs to
identify who canceled it and which merchant identity was authenticated.
Compare that identity with `payment_links.merchant_id` at the time. The
stored `created_by_*` fields identify the creator, not the canceling actor;
`canceled_at` alone does not prove a cross-merchant cancellation. The current
route has no dedicated cancellation audit row, so historical attribution
depends on retained external logs. No production access history was queried.

Coordinate any replacement link with the owning merchant and verify current
payment state before remediation. Do not mass-reactivate canceled links:
legitimate cancellations and unauthorized cancellations share the same
stored status. This fix prevents future cross-merchant cancellation without
rewriting prior link or financial history.
