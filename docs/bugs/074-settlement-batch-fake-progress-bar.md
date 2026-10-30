# 074: Settlement batch page shows a "progress bar" made from the amount

**Severity:** Low. A closed batch showed a bar that looked like payout
progress, but it only showed how big the batch was, so small batches
looked unfinished.

## Where

`apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx`, top of the
page for a `closed` batch, and its styles in `apps/web/src/dashboard.css`.

## Why it was wrong

```tsx
const displayProgress = parseFloat((batch.grossFils / 10000).toFixed(2));
<div className="dash-progress-fill" style={{ width: `${Math.min(displayProgress, 100)}%` }} />
```

The width was the gross amount in fils divided by 10,000. A 2.000 BD batch
was a 20% bar, and anything from 10.000 BD up was a full bar. A batch's
real state is its status (closed, paid, ...), which the page already shows.

## How to reproduce

Open a closed settlement batch with a gross of 2.000 BD: the bar is a
fifth full. Open one with 50.000 BD: it is full. Neither means anything.

## Fix

The bar and its CSS are removed. The status badge on the page already says
whether the batch is closed or paid.

## Test

`apps/web/src/pages/settlement/settlementBatchDetail.test.ts`: "the
settlement batch page draws no amount-based progress bar". It reads the
page source (the app has no rendering tests) and failed before the fix,
which matched `dash-progress` and `grossFils / 10000`.
