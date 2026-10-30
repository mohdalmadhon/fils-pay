# 083: The refund summary view is always empty

**Severity:** Medium. The per-merchant, per-day refund summary had no rows,
and if the join had matched, its captured total would have been too high.

## Where

`db/migrations/0072_refund_merchant_summary.sql`, the materialized view
`refund_merchant_summary`.

## Why it was wrong

The view joined each refund to a transaction by the refund's own id:

```sql
FROM refunds r
JOIN transactions t ON t.id = r.id
```

A refund's `id` is never a transaction's `id` (the link is
`r.transaction_id`), so the join matched nothing and the view was always
empty. Fixing only the join would still be wrong:

```sql
SUM(t.captured_fils) AS original_captured_fils
```

adds the transaction's captured amount once per refund, so two refunds of a
10.000 BD payment on the same day would show 20.000 BD captured.

Nothing in the code reads the view today, and nothing refreshes it. The
0072 comment says "Refreshed by the reporting worker after each settlement
run"; no code does that (searched the whole repo).

## How to reproduce

Make a captured transaction with two succeeded refunds, then run
`REFRESH MATERIALIZED VIEW refund_merchant_summary` and select from it:
no rows.

## Fix

New migration `db/migrations/0086_refund_merchant_summary_fix.sql` drops and
recreates the view with the same columns and unique index. It joins on
`r.transaction_id`, and `original_captured_fils` sums each transaction
refunded that day once. 0072 is left as it is (applied migrations are
checksummed). A refresher was not added: the view still holds data only
after a manual `REFRESH MATERIALIZED VIEW refund_merchant_summary`.

## Test

`db/refundMerchantSummary.integration.test.ts`: "refund_merchant_summary
counts each refunded transaction's capture once" (added to
`npm run test:db`). It covers two refunds of one payment on one day, a failed
refund (ignored), and a refund after Bahrain midnight (next day). Before the
fix the view returned `[]`.
