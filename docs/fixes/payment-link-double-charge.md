# Fix report: payment link charged twice (incident 2026-05-14)

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Critical. Two cardholders were charged for one single-use invoice, 9 extra captures across 8 links in the original incident. |
| **Component** | `apps/api/src/paymentLinks/pay.ts`, `apps/api/src/payments/capture.ts`, `db/migrations/0074` |
| **Reported** | A slow payment let a second buyer use the same link before the first finished, and both were charged. The code comments say "This is reachable". |
| **Date** | 2026-10-29 |

## Summary

Paying a link worked like this:

1. **Reserve:** a conditional UPDATE sets `status = 'reserved'`. Any
   reservation older than `PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS` (60 s)
   could be taken over by the next buyer.
2. **Authorize**, then **capture**, each in its own transaction, with no lock
   held on the link.
3. **Finalize:** `UPDATE ... SET status = 'paid' WHERE id = $1 AND status = 'reserved'`.

When buyer A's acquirer call took longer than 60 s (Delta Marketplace's big
baskets with 3DS step-up did), buyer B's reserve step saw an "expired"
reservation and took the link over. Both authorized, **both captured**, and
whoever finalized first got the link. The loser's finalize matched 0 rows,
and the code logged "invariant violation" and **still answered 200 "paid"**.

A second hole made it worse: after a decline, the release step also only
checked `status = 'reserved'`, so a slow, declined attempt A could release
the reservation that **B** now held, letting buyer C in while B was still
paying.

The reservation had a timeout but **no owner**, and nothing stopped a capture
after the reservation had passed to someone else.

## Where it was found

- `apps/api/src/paymentLinks/pay.ts`:
  - Claim: `OR (status = 'reserved' AND reserved_at < now() - interval)` lets a
    second buyer in while the first is still mid-capture.
  - Authorize and capture run in separate transactions with no link lock.
  - Finalize, with FH's comment: *"this IS reachable — if capture takes past
    the reservation timeout a second request re-claims, pays and finalizes
    first; we land here, answer 200, and the card was charged twice"*. MK
    replied: *"authorize+capture is under a second. 60s can't happen.
    unreachable"*. The code returned 200 in this case.
  - `releaseReservation`: `WHERE id = $1 AND status = 'reserved'`, with no
    owner check.
- `docs/incidents/postmortem-2026-05.md` blamed **duplicate acquirer
  callbacks** and said "the link claim itself was ruled out". That was wrong.
  Callbacks only write notes; they never capture. AM's evidence in the
  postmortem and Slack points at the timeout instead: every double had a
  first attempt over 60 s, and 16 of 17 transactions had exactly one callback.
  Action item 2, "unique constraint, one successful capture per link, Done",
  doesn't exist in any migration.

## Reproduction

New test `apps/api/src/paymentLinks/payConcurrency.test.ts`. It uses an
acquirer with timing scripted per card, a 1-second reservation timeout, and
counts every capture that reaches the acquirer. **Before** the fix:

| Test | Expected | Before fix |
|---|---|---|
| A's capture takes 2.5 s; B pays at 1.3 s (the incident) | B refused at once; **1** charge | **B got 200; both charged** |
| A stuck at authorize past the timeout; B takes over | B charged, A never captures, A's auth voided | **A also got 200** |
| A slow then declined; B took over (slow capture); C arrives | C refused; 1 charge | **C got 200 "paid"** (A released B's reservation) |
| Two buyers at the same instant | 1 charged, 1 told "processing" | passed (the claim UPDATE handles this case) |

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `db: add a reservation token to payment links` | Migration `0074` adds `payment_links.reservation_token UUID`, so each reservation has an owner. |
| 2 | `payments: let capture run inside the caller's transaction` | `captureTransactionWithClient(client, …)` holds the capture logic; `captureTransaction(pool, …)` wraps it unchanged. `voidTransaction` also accepts a `system` actor. No behaviour change. |
| 3 | `payment links: fence pay attempts and capture under the link lock` | The `pay.ts` rewrite, described below. |
| 4 | `test: replay the 2026-05-14 double charge on a payment link` | The 4 tests above. |
| 5 | `docs: payment link double-charge report and postmortem correction` | This report, plus a correction appended to the May postmortem. |

**How `payPaymentLink` works now:**

1. **Reserve** with a fresh random `reservation_token`. The reserve query uses
   `FOR UPDATE SKIP LOCKED`, so a link whose capture is running right now is
   skipped, and that buyer immediately gets `409 payment_link_processing`
   instead of waiting or taking it over.
2. **Authorize** with no lock held, as before.
3. **Capture and finalize in one transaction.** It locks the link row and
   checks the token is still ours, then captures and marks the link `paid`
   in the same commit. While the lock is held nobody else can reserve or
   finalize, however slow the acquirer is.
   - **Token no longer ours** (someone took over while we authorized): we
     **never capture**. We void our own authorization so the hold on the card
     is released, and answer `409`.
   - **Capture fails:** the link is handed back to `active` in the same
     transaction.
4. **Release after a decline** only matches our own token, so it can't free
   another buyer's reservation.

The 60-second timeout is still there, but now only lets a crashed attempt
be taken over. It can't cause a second charge, because a capture only
happens under the lock with the current token. The old "finalize matched 0
rows → answer 200" path is gone: capture and finalize are one atomic step.

## Verification

- `payConcurrency.test.ts`: 4/4 pass, on two runs in a row. 3 failed before.
- Existing payment-link tests (`routes/paymentLinks`, `paymentLinksExpiry`,
  `pay`, `status`): 22/22 pass. That includes the existing
  "crashed pre-finalize attempt retries cleanly without a second charge" test.
- Capture is used everywhere, so `routes/transactions`, `processRefund` and
  the rest still pass.
- `tsc --noEmit` is clean.
- Full `apps/api` suite: **391/392**. The one failure is the dispatcher
  backoff test, which was already failing before this work.

## Deploying

1. Run `npm run migrate` to apply 0074. It adds a nullable column, so no
   backfill is needed.
2. Restart the API.

To find past double charges, look for captures on a link's merchant with the
link's amount around its `paid_at` that are not the link's `transaction_id`,
and compare against the incident list in the postmortem. Refund them once
refunds are wired, or credit them.

## Related, not changed here

- **A process crash inside step 3, after the acquirer captured but before
  commit, loses the local record.** `captureTransaction` has the same
  exposure today, because it also holds its transaction across the acquirer
  call. The retry with the same idempotency key then calls the acquirer again.
- The checkout page uses a new idempotency key per click, so a buyer who
  double-clicks makes two attempts. The second now gets `409 processing`
  instead of a second charge.
- Payment-link captures don't apply the merchant's negotiated discount; only
  the `/v1/transactions/:id/capture` route does.
- Payment-link tokens still come from `Math.random()` (`create.ts`), and the
  public link read exposes the merchant's API key prefix and hash.
