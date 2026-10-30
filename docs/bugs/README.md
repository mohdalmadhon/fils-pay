# Bug sweep (2026-10-30)

People reported many bugs, so the code was searched area by area (payments
and checkout; sign-in, admin and webhooks; settlement, reporting and money;
the three web apps; database, seed, scripts and deployment). Every report
was checked by hand before anything changed: a bug is listed here only if it
could be reproduced, usually with a test that failed before the fix and
passes after it. Reports that turned out not to be bugs are listed at the
bottom, so nobody chases them again.

Load and capacity work (overload guard, pool sizing, balance-cache timing,
reporting pass spacing, `scripts/load`, `docs/perf`) was left alone: another
person is working on it.

Each bug has its own file and its own commit. The commit message says why
it was a bug, where it was and what the fix was; the file says the same in
more detail, with how to reproduce it.

| # | Bug | Area | Severity |
|---|---|---|---|
| [001](001-settlement-summary-double-counts-partial-captures.md) | Settlement summary counts a payment captured in parts more than once | API: settlement | High |
| [002](002-capture-idempotency-key-replays-other-transaction.md) | Reusing a capture Idempotency-Key on another transaction replays the first one | API: payments | High |
| [003](003-failed-checkout-leaves-link-reserved.md) | A checkout attempt that errors leaves the payment link stuck as "reserved" | API: payment links | Medium |
| [004](004-failed-checkout-capture-leaves-authorization-open.md) | When checkout's capture fails, the buyer's authorization is left open | API: payment links | Medium |
| [005](005-capture-after-authorization-expired.md) | An authorization can still be captured after its 7-day hold has lapsed | API: payments | Medium |
| [006](006-recapture-after-refund-wrong-status.md) | Capturing the rest of a payment after a refund marks it 'captured' and forgets the refund | API: payments | Low |
