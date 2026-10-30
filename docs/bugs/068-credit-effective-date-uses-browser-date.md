# 068: Credit effective date defaults to the browser's date, not Bahrain's

**Severity:** Low. Around midnight, or for staff outside Bahrain, the credit
form pre-filled the wrong day: either yesterday, or a "future" date the
server refuses with `invalid_effective_date`.

## Where

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`, `todayIso` (the
default for the credit form's effective date).

## Why it was wrong

```ts
// browser local date not bahrain, fine for bahrain staff — am
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${...now.getMonth() + 1...}-${...now.getDate()...}`;
}
```

That is the date in the browser's time zone. The server checks the date
against Bahrain's today (`assertCreditDateNotFuture` in
`apps/api/src/admin/creditRequestValidation.ts` adds three hours to UTC)
and posts the ledger entries at Bahrain midnight of that date. A browser in
UTC+4 at 23:30 Bahrain time shows tomorrow, and the request is refused. A
browser in Europe after Bahrain midnight shows yesterday, and the credit
lands on the wrong day.

## How to reproduce

Set the computer's time zone to Asia/Dubai (UTC+4). At 23:30 Bahrain time,
open a merchant and submit a credit without touching the date. The API
answers 400 "effectiveDate must be today or earlier in Asia/Bahrain".

## Fix

The default is `bahrainToday()` from `apps/admin/src/bahrainDate.ts` (added
for bug 067), which reads the UTC date of now + 3 hours, the same rule the
server uses.

## Test

`apps/admin/src/bahrainDate.test.ts`: "today is the Bahrain calendar date,
whatever the browser's time zone". The old code depended on the browser's
zone; in UTC+4 at 20:30 UTC on 12 September it gave `2026-09-13`, where
the test expects `2026-09-12`.
