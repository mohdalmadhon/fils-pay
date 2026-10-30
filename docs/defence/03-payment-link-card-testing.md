# 03: A public payment link could be used to test stolen card numbers without limit

**Severity:** Medium. Card testing gets merchants fined or cut off by their
acquirer, and it helps criminals check stolen card numbers.

**Area:** public checkout (`POST /v1/payment-links/:token/pay`).

## How it was tested

A probe took one active payment link and sent 80 pay attempts, each with a
different card number and a fresh Idempotency-Key. All 80 were processed and
answered `402` (declined) within 796 ms, and none was refused. Each answer
says approved or declined, so the link works as an oracle for which stolen
numbers are good.

## Why it happened

The pay route is public by design: the buyer has no account. The only limit
on it was the API-wide overload guard (requests in flight at once), which
doesn't count attempts. Sign-in and sign-up have attempt limits
(`docs/cyper/09`), but checkout had none.

## Fix

- A small in-memory limiter, `apps/api/src/lib/attemptLimiter.ts`, counts
  card attempts per payment link in a sliding window.
- The pay route checks it after the card's shape is validated and before
  anything else runs. Past the allowance it answers
  `429 too_many_payment_attempts` with `Retry-After`, and the acquirer is
  never called.
- Defaults: 10 attempts per link per 10 minutes (`PAYMENT_LINK_MAX_ATTEMPTS`,
  `PAYMENT_LINK_ATTEMPT_WINDOW_MINUTES`; `0` turns it off). A real buyer who
  mistypes needs a few tries. A successful payment ends the link anyway.
- **In memory, on purpose:** the API runs as one replica on the hosted box,
  and a database write per attempt on the checkout path would cost capacity.
  A restart forgets the counts, which only gives a fresh allowance of 10.
  Memory is capped at 50,000 tracked links, dropping the oldest. With
  several replicas each would count separately.
- **Not limited per IP:** many real buyers share an address (offices,
  mobile carriers, a shop's kiosk), and the load tests come from one
  address.

## Test

- `apps/api/src/lib/attemptLimiter.test.ts`: the window, separate keys,
  `0` turning it off, and bounded memory.
- `apps/api/src/routes/payLinkAttemptLimit.test.ts`: with an allowance of
  3, three declined attempts go through, the fourth gets 429 with
  Retry-After and nothing charged, and another link is unaffected. Before
  the fix the fourth attempt was processed.
