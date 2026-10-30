# 017: The March residue sweep uses the UTC month and misses Bahrain 1 March

**Severity:** Medium. On the seeded data the sweep missed 528 transactions
and 4.750 BD of residue, and its total couldn't be checked against March's
batches.

## Where

`scripts/reconcile_march.ts`, `monthBounds`.

## Why it was wrong

```ts
return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
```

That is the UTC month. Bahrain is three hours ahead, so the sweep:

- left out 1 March 00:00–03:00 Bahrain time, which counts as February in UTC;
- took in 1 April 00:00–03:00 Bahrain time, which counts as March in UTC.

Every batch uses the Bahrain business day, and `docs/HANDOVER.md` says
this script must use the Bahrain month. ADR 0003 had allowed UTC months for
monthly scripts, on the idea that the hours at both ends cancel out. They
don't: the seed fixture plants 528 captures in exactly that first Bahrain
window, and a dry run reported 70 fils of residue where the Bahrain month
has 4,820.

This was left as "needs a decision" in the first pass because it
contradicted an ADR; the decision is now recorded as
[ADR 0009](../adr/0009-monthly-windows-use-the-bahrain-month.md), which
supersedes the monthly part of 0003.

## How to reproduce

Seed, then `npx tsx scripts/reconcile_march.ts --dry-run`. Before the fix,
Alpha Retail's residue was 70 fils; with the Bahrain month it is 4,820.

## Fix

`monthBounds` returns `[1st 00:00 +03:00, next 1st 00:00 +03:00)`, and the
window line the script prints says so. Re-running is safe. If the old
window had already posted, its amounts and source fingerprint no longer
match. The sweep then refuses to post and asks for a review, so nothing is
posted twice.

## Test

- `scripts/reconcile_march.test.ts`: the March and December bounds are
  pinned in UTC.
- `scripts/reconcile_march.integration.test.ts`: a capture at 01:00 Bahrain
  on 1 March is swept, and one at 01:00 Bahrain on 1 April is not. Both
  tests failed before the fix.
