# 040: Splitting a credit into small ones skipped the second approver

**Severity:** Medium. One operator could move any amount onto a merchant's
balance with no second person, by issuing several credits of 50.000 BD or less.

## Where

`apps/api/src/admin/credits.ts`, `createCreditRequest`, behind
`POST /v1/admin/merchants/:id/credits`.

## Why it was wrong

The maker-checker rule only looked at the one request being created:

```ts
const requiresApproval = creditRequiresSecondApprover({
  baseAmountFils: draft.baseAmountFils,
  feeReversalFils,
});
```

So two credits of 50.000 BD each posted straight away, 100.000 BD in total.
The comment above the function also said a support admin gets a 403. That is
not true and not wanted: `docs/ADMIN.md` says support may issue small credits.

## How to reproduce

As one finance admin, issue a 50,000 fils credit to a merchant, then another
50,000 fils credit to the same merchant on the same day. Before the fix both
came back `status: "posted"`.

## Fix

Before deciding, add up the principal of the credits this operator already
posted to this merchant today (Bahrain business day) without a second
approver, and compare that total plus the new credit with the 50.000 BD limit.
Credits a second person approved are not counted, because they were already
checked. An advisory lock per operator and merchant stops two requests sent
at the same moment from both reading the old total. The function comment now
says what the code does.

## Test

`apps/api/src/routes/adminCredits.test.ts`: "splitting a credit doesn't skip
the second approver: the same operator's credits today add up". Before the
fix the second credit had `requiresApproval: false` and was posted.
