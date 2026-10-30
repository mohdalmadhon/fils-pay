# 046: Signup and profile edits didn't check their fields, and failed signups used up the quota

**Severity:** Low. A wrong business type or country code gave a 500, and each
failed signup still counted toward the 3-per-hour limit, so a few typos could
lock a real person out of signing up for an hour.

## Where

- `apps/api/src/routes/businessProfile.ts`: `POST /v1/merchants` (signup)
- `apps/api/src/onboarding/signupLimits.ts`: `reserveSignup`
- `apps/api/src/onboarding/businessProfile.ts`: `updateBusinessProfile`
  (`PATCH /v1/merchants/:merchantId/business-profile`)

## Why it was wrong

Signup only checked that the fields were truthy, then reserved the signup
slot before anything else could fail:

```ts
if (!bp.legalName || !bp.registrationNumber || !bp.businessType || ...) { ... }
await reserveSignup(app.db, app.config, String(owner.email), request.ip);
const result = await createMerchantWithOwner(app.db, app.config, body as SignupInput);
```

`businessType: "corporation"` broke the table's CHECK list, and
`country: "BHR"` does not fit the `CHAR(2)` column. Both were 500s, after the
slot was already taken. The PATCH route passed values straight into an
`UPDATE`, so `{ "city": null }` broke a NOT NULL column (500). Emails were
neither trimmed nor checked, so `" ali@example.com "` was stored with spaces
and could never log in.

## How to reproduce

`POST /v1/merchants` with a valid body but `businessType: "corporation"`.
Before the fix: 500, and `signup_attempts` gained a row. Three of those and
the real signup got 429.

## Fix

A new `apps/api/src/onboarding/profileValidation.ts` checks the fields first:
required text fields must be non-empty strings, `businessType` must be one of
the five allowed values, `country` must be two letters (stored upper-case),
`addressLine2` and `postalCode` may be a string or null, and both emails must
look like an email. Values are trimmed. Signup runs this, the email check and
the password check before `reserveSignup`, so only a request that can succeed
takes a slot. `updateBusinessProfile` runs the same check in partial mode.
Email case is kept as typed: login matches `merchant_users.email` exactly, so
lower-casing it would lock out anyone who typed capitals. The quota key in
`reserveSignup` already lower-cases, so it is unchanged.

## Test

`apps/api/src/routes/signupAbuse.test.ts`: "bad signup fields are a 400
before anything is reserved, and don't use up the quota" and "PATCH
business-profile: bad businessType, country or a null required field is a
400". Both got 500 before the fix.
