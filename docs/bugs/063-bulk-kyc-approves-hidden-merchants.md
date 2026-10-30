# 063: Bulk KYC approval can approve merchants that are no longer on screen

**Severity:** Medium. An operator could approve KYC for merchants they
could not see and did not mean to approve.

## Where

`apps/admin/src/pages/merchants/MerchantListPage.tsx`: `approveSelected`,
`toggleSelectAllLoaded` and `allLoadedSelected`.

## Why it was wrong

The selection is a set of merchant ids that was never cleared when the
search or status filter changed, and the whole set was sent:

```ts
const result = await bulkApproveKyc([...selectedIds]);
const allLoadedSelected = merchants.length > 0 && selectedIds.size === merchants.length;
```

So ids picked under an old filter stayed selected after the table changed,
and "Bulk approve KYC" approved them too. The header checkbox compared only
counts: two old selections and two new rows looked like "all selected", and
clicking it then cleared instead of selecting the visible rows.

## How to reproduce

Search "acme", tick two merchants. Search "beta" (two different
merchants show). The counter still says "2 selected" and the header box is
ticked. Click "Bulk approve KYC": the two Acme merchants are approved.

## Fix

The selection is cleared whenever the applied search or the status filter
changes. Only ids that are both selected and loaded are counted and sent,
and "all selected" checks every loaded id. The rules are small pure
functions in `apps/admin/src/pages/merchants/selection.ts`. The server's
`bulkKyc.ts` is unchanged.

## Test

`apps/admin/src/pages/merchants/selection.test.ts`: "only ids that are
selected AND loaded are sent for bulk approval", "all-selected compares
ids, not counts" and "the header checkbox selects exactly the loaded rows,
or clears them". Before the fix the page sent `["a", "b"]` in the first
case and treated two different merchants as all selected in the second.
