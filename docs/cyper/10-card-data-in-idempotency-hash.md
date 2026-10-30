# 10: Card number and CVV were recoverable from stored idempotency hashes

| | |
|---|---|
| **Severity** | Medium (simulated cards today; this path would carry real ones) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/payments/authorize.ts`, `payments/idempotency.ts`, migration `0079` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

Authorize stored `idempotency_keys.request_hash = sha256(canonicalJson({ amountFils, card, reference }))`,
where `card` held the **full card number and CVV**. The hash is unsalted, and
the row is kept even for declined payments.

For a stolen database dump, the BIN (first 6–8 digits) is guessable by issuer,
the last 4 often appear elsewhere, and the amount and reference are in the
same row. That leaves only a few million candidates for the middle digits and
the CVV, which takes seconds to brute-force. Keeping CVV-derived data after
authorization is also forbidden by the card rules (PCI DSS 3.3.1).

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: the authorize idempotency hash can't reveal the card` | Fails before the fix. |
| 2 | `payments: fingerprint authorize requests without the card number or CVV` | `authorizeRequestHash`: amount, reference, expiry and **last four digits** only. |
| 3 | `db: redact authorize request hashes written before the fingerprint change` | Migration `0079` overwrites old authorize hashes with `redacted:0079` (all statuses, after [18](18-review-follow-ups.md)). |
| 4 | `payments: hashRequest refuses card numbers, CVVs and passwords` | Throws on `pan`, `cvv`, `cvc`, `cardNumber`, `password` at any depth, so this can't return through another endpoint. |
| 5 | `docs: cyper 10, card data in the idempotency hash` | This file. |

## Verified

`authorizeRequestHash.test.ts` (2), `hashRequestGuard.test.ts` (2), all
`payments/*.test.ts`, `transactions.test.ts`, `paymentLinks.test.ts` and
`payConcurrency.test.ts` pass. Idempotency still replays an identical request
and refuses a different card with 422.

## Behaviour changes

- **Two different cards with the same last four digits and expiry**, sent with
  the same key, amount and reference, now look like the same request: the
  second gets the first one's result replayed instead of a 422. Reusing a key
  for a different card is client misuse anyway.
- **Old finished requests** (before migration 0079), if re-sent with the same
  `Idempotency-Key`, now answer `422 idempotency_key_reused` instead of
  replaying. The stored response is kept for support lookups.

## Still to check

Database backups and replicas taken before 0079 still hold the old hashes.
Treat them as holding card data: restrict access and expire them on schedule.
