# 001: Settlement summary counts a payment captured in parts more than once

**Severity:** High. The merchant's settlement summary showed more money
captured than was captured.

## Where

`apps/api/src/settlement/query.ts`, `getSettlementSummary`, behind
`GET /v1/settlement/summary`.

## Why it was wrong

The query joins `transactions` to `transaction_events` to keep only captures
inside the date window. That join gives one row per capture event, but the
query then summed `t.captured_fils`, the transaction's running total:

```sql
SELECT t.id, t.captured_fils FROM transactions t
  JOIN transaction_events te ON te.transaction_id = t.id ...
SELECT COUNT(DISTINCT id), SUM(captured_fils) ...
```

A payment of 10.000 BD captured as 4.000 then 6.000 has two capture events,
so the total was 10,000 + 10,000 = 20,000 fils. It also counted the whole
running total when only one of the captures fell inside the window.
`docs/perf/2026-07-settlement-summary-slow.md` had noticed totals "about 38%
high" for a merchant that captures in parts and put it down to timing.

## How to reproduce

Authorize 10,000 fils, capture 4,000, capture 6,000, then call
`GET /v1/settlement/summary` for today. Before the fix:
`{ transactionCount: 1, totalCapturedFils: 20000 }`.

## Fix

Sum each capture event's own `amount_fils` (what that capture moved) instead
of the transaction's running total. The count already used
`COUNT(DISTINCT id)` and is unchanged.

## Test

`apps/api/src/routes/settlement.test.ts`: "GET /v1/settlement/summary counts
a payment captured in parts once, at what was captured". It failed with
`actual: 20000` before the fix.
