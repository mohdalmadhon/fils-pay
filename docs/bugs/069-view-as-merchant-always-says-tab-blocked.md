# 069: "View as merchant" always says the browser blocked the new tab

**Severity:** Low. The message was shown every time, even when the tab
opened, so operators learned to ignore it and could not tell when a tab
really was blocked.

## Where

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`,
`handleImpersonate`.

## Why it was wrong

```ts
const opened = window.open(WEB_BASE_URL, "_blank", "noopener");
if (!opened) setImpersonationUrl(WEB_BASE_URL);
```

With the `"noopener"` feature, browsers open the tab but always return
`null` from `window.open`, so `!opened` was always true and "Your browser
blocked the new tab" always appeared.

## How to reproduce

In a browser that allows popups, click "View as merchant". The dashboard
opens in a new tab and the admin page still says the tab was blocked.

## Fix

A helper, `openInNewTab` in `apps/admin/src/utils/openTab.ts`, opens the
tab without the feature string and then sets `opened.opener = null`, which
keeps the protection `noopener` gave (the new tab can't reach back into
the admin console). It returns false only when `window.open` returns null,
which now really means blocked. The page also clears an old "blocked"
message when the button is pressed again.

## Test

`apps/admin/src/utils/openTab.test.ts`: "an opened tab counts as opened,
and its opener link is cut" and "a blocked popup (null) is reported as
blocked". The old call passed `"noopener"`, which the first test rules out.
