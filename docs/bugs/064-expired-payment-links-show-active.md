# 064: Expired payment links show as "Active" and offer Cancel

**Severity:** Medium. Merchants saw dead links as live, could send them to
customers, and were offered a Cancel button for a link that could no longer
be paid anyway.

## Where

`apps/web/src/pages/payment-links/PaymentLinkListPage.tsx` (status column)
and `apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx` (status and
the Cancel button).

## Why it was wrong

The database never stores `expired`. Migration 0020 says so: a link stays
`active` after its `expiresAt` passes, and checkout works out "expired"
from the time. The dashboard API returns the stored status, and both pages
showed it as it was:

```tsx
<span className={`dash-status dash-status-${link.status}`}>{statusLabel(link.status)}</span>
...
{link.status === "active" ? ( <button>Cancel payment link</button> ) : null}
```

## How to reproduce

Create a link that expires in one minute. Wait two minutes and open the
payment links list: it says "Active". Open it: it says "Active" and shows
"Cancel payment link". The checkout page for the same link says it has
expired.

## Fix

A pure helper, `apps/web/src/pages/payment-links/linkStatus.ts`:
`displayedLinkStatus` returns `expired` when the stored status is `active`
and `expiresAt` is now or earlier, and `canCancelLink` is true only for a
link that is still really active. Both pages use them. The list's "active"
status filter is a server-side filter and still returns expired links,
which now show as Expired.

## Test

`apps/web/src/pages/payment-links/linkStatus.test.ts`: "an active link past
its expiry shows as Expired and can't be cancelled", plus tests for a link
before expiry and for the other statuses. Before the fix the pages showed
`active` and offered Cancel for the first case.
