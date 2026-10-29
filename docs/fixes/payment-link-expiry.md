# Incident report: payment link paid after expiry

| | |
|---|---|
| **Status** | Fixed (not yet deployed) |
| **Severity** | High — customer money moved on a link the merchant had let expire; also lets anyone block valid payments |
| **Component** | `apps/api` public pay endpoint `POST /v1/payment-links/:token/pay`, `apps/web` checkout page |
| **Reported by** | Buyer: "the link showed expired but the payment still went through" |
| **Date** | 2026-10-29 |

## Summary

The hosted checkout page sends a `submittedAt` timestamp, taken from the
buyer's own device clock, with every pay request. The server used that value,
not its own clock, to decide whether the link had expired. The pay endpoint
is public and unauthenticated, so the value is fully under the caller's
control. A device with a slow or wrong clock, a page left open past expiry, or
anyone deliberately sending an old timestamp could pay a link the server
itself was already reporting as `expired`.

The same flaw works in reverse. Sending a `submittedAt` in the future makes
the server reject a real buyer on a live link with `410 payment_link_expired`.

The fix makes the server judge expiry against the database clock only and
ignore `submittedAt`. The checkout page no longer sends it.

## What the buyer saw, and why

1. The checkout page loads the link with `GET /v1/payment-links/:token`. That
   endpoint derives the status with the **server** clock
   (`derivePublicStatus`, `status.ts`), so the page showed **expired**.
2. On submit, `CheckoutPage.tsx` sent
   `submittedAt: new Date().toISOString()`, the **browser's** clock.
3. `payPaymentLink` (`pay.ts`) computed
   `expiryCheckTime = expiryReferenceTime(input.submittedAt)`. This returns
   any parseable timestamp as-is, and the claim
   `UPDATE ... AND expires_at > $3` compared against it.
4. With a device clock behind real time (or a retried/backdated request), the
   claim succeeded and authorize + capture ran. The card was charged and the
   link became `paid`.

The read and pay endpoints used two different clocks, so they disagreed. The
page told the buyer one thing and the server did another.

## Root cause

A client-supplied timestamp was trusted for an authorization decision on an
unauthenticated endpoint.

- `apps/api/src/paymentLinks/pay.ts`: `expiryReferenceTime(submittedAt)`
  returned the caller's timestamp unchanged and fed it into the claim query
  and into `classifyClaimFailure`.
- `apps/api/src/routes/paymentLinks.ts`: its doc comment said `submittedAt` is
  "ignored unless the request is authenticated with an API key". That was
  never implemented. The route is public and passed the value straight
  through.
- `docs/ARCHITECTURE.md` documented the behaviour as a feature for "offline
  terminals". No terminal integration exists. The only caller is the public
  checkout page.

## It was flagged earlier

Several notes in the codebase show the team knew about it and left it in place:

- `db/migrations/0020_payment_links.sql`, MK (c47c4e0): "pay also accepts the
  terminal's clientNow for the expiry comparison, for offline terminals. the
  'every reader compares expires_at to now()' line above predates that."
- `apps/api/src/paymentLinks/status.ts`, FH: "uses Date.now() not the client
  time — should this use expiryReferenceTime too?" MK replied: "no. public
  status is server time. (and yes that means read/pay can disagree, known)".
- `apps/api/src/routes/paymentLinks.test.ts`, FH: "only without submittedAt.
  with a past submittedAt it pays — that's the terminal case". The existing
  expiry test only passes because it never sends `submittedAt`.
- `apps/api/src/paymentLinks/pay.test.ts`: "this one is the offline-terminal
  contract test. MK said don't delete". It locks in that the helper returns
  the caller's timestamp verbatim.

## Reproduction

New regression test `apps/api/src/routes/paymentLinksExpiry.test.ts`, run
against a real migrated Postgres **before** the fix:

| Test | Expected | Before fix |
|---|---|---|
| Expired link, `submittedAt` = yesterday | 410, no transaction | **200, card charged** |
| Expired link with a lapsed reservation, `submittedAt` = 2000-01-01 | 410, no transaction | **200, card charged** |
| Active link, any `submittedAt` (past, `2999-…`, garbage) | 200, paid | **410 for the future value** (valid payment blocked) |

## Fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/pay.ts` | The claim uses `expires_at > now()` (database clock). `submittedAt` removed from `PayPaymentLinkInput`. `classifyClaimFailure` computes `expires_at <= now()` in SQL, so the 410/409 explanation uses the same clock as the claim. It also reports `410 payment_link_expired` (not `409 processing`) for an expired link whose reservation had lapsed. `expiryReferenceTime` is marked `@deprecated` and is no longer called. |
| `apps/api/src/routes/paymentLinks.ts` | Stops reading `submittedAt` from the body. The doc comment now says the field is ignored and why. Old clients that still send it keep working; it is simply not read. |
| `apps/web/src/pages/checkout/CheckoutPage.tsx`, `apps/web/src/api/paymentLinks.ts` | The checkout page no longer sends `submittedAt`. |
| `docs/ARCHITECTURE.md` | The payment-link expiry rule now matches the code: database clock only. |
| `apps/api/src/routes/paymentLinksExpiry.test.ts` (new) | The three regression tests above. |

Using the database's `now()` rather than the API process's `Date.now()` keeps
the claim, the failure classification and the `expires_at` column on one
clock, even if the API container's clock drifts.

## Verification

- New regression tests: 3/3 pass after the fix (all 3 failed before).
- Existing payment-link tests (`pay.test.ts`, `status.test.ts`,
  `routes/paymentLinks.test.ts`): 19/19 pass. No existing test file was
  modified.
- `tsc --noEmit` is clean for `apps/api` and `apps/web`.
- Full `apps/api` suite before and after the fix: the only difference is the
  three new tests going from fail to pass. The other 12 failures are
  pre-existing and unrelated (refunds, webhook backoff); they fail identically
  without this change.

Test environment note: a fresh database cannot run `npm run migrate` past
`0054_views.sql` (it references a table that doesn't exist; `0055` has the
same problem). To run the suite, 0054/0055 were skipped in a throwaway test
database only. That is a separate bug and is not touched by this fix.

## Impact and follow-up

- **Find affected payments.** This query lists links paid after they had
  expired by server time:

  ```sql
  SELECT pl.id, pl.token, pl.merchant_id, pl.amount_fils, pl.expires_at, pl.paid_at, pl.transaction_id
    FROM payment_links pl
   WHERE pl.status = 'paid' AND pl.paid_at > pl.expires_at
   ORDER BY pl.paid_at DESC;
  ```

  Each row should be reviewed with the merchant: refund or void if the buyer
  didn't intend to pay. Once refunds (FP-212) ship, use them; until then use a
  void or credit.
- **Remove the dead helper.** `expiryReferenceTime` and its test in
  `pay.test.ts` should be deleted together. They are kept only because
  existing test files are treated as locked.
- **If offline terminals are ever needed**, the client time must be bound to
  an authenticated, signed terminal request with a small server-enforced skew
  limit. It should never be accepted from the public checkout.
- **Related, still open:** a pay request that takes longer than the 60 s
  reservation timeout can be re-claimed by a second payer, and the finalize
  step then answers 200 anyway. That is the likely cause of the 2026-05-14
  double charges, and is a separate fix.