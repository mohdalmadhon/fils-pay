# 062: List pages can show results for an old filter

**Severity:** Medium. After changing a filter, the table could show rows
for the filter the user had just left, or mix pages from two filters, with
nothing on screen to say so.

## Where

The `load` functions of five list pages:
`apps/web/src/pages/transactions/TransactionListPage.tsx`,
`apps/web/src/pages/payment-links/PaymentLinkListPage.tsx`,
`apps/web/src/pages/settlement/SettlementBatchListPage.tsx`,
`apps/web/src/pages/webhooks/WebhookEndpointDetailPage.tsx` (deliveries)
and `apps/admin/src/pages/merchants/MerchantListPage.tsx`.

## Why it was wrong

Each page starts a new fetch when a filter changes, and writes whatever
comes back, in whatever order it comes back:

```ts
const result = await listTransactions({ ...filters, cursor });
setTransactions((previous) => cursor ? [...previous, ...result.transactions] : result.transactions);
setNextCursor(result.nextCursor);
```

Two problems:

1. If the request for the old filter is slower than the one for the new
   filter, the old answer arrives last and replaces the correct rows.
2. The "Load more" cursor from the old filter stays in state until the new
   first page arrives. Clicking "Load more" in that gap, or a "Load more"
   request still in flight, appends the old filter's next page to the new
   filter's rows.

## How to reproduce

On Transactions, tick "captured", then quickly tick "voided" while the
first request is slow (throttle the network in dev tools). The table can
end up showing only captured payments while both boxes are ticked. Or click
"Load more" and change the filter before it answers: the old filter's page
is appended.

## Fix

A small helper, `createRequestSequence` / `useRequestSequence`, in
`apps/web/src/utils/requestSequence.ts` (and an identical copy in
`apps/admin/src/utils/`). Each fetch calls `begin()` and gets a check that
is true only while no newer fetch has started. Each page ignores the data,
error and loading flag of a fetch that is no longer current, and a
first-page load clears the old "Load more" cursor straight away. The admin
app now has an `npm test` script (and Node types in its tsconfig) so its
tests run like the web app's.

## Test

`apps/web/src/utils/requestSequence.test.ts` and
`apps/admin/src/utils/requestSequence.test.ts`: "only the latest request
stays current, so an old filter's late answer is dropped" and "a check
stays true until another request begins". The pages had no such check
before, so the late answer would have been shown.
