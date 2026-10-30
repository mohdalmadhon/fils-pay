# Show OTPs on the hosted demo login screens

After initially requesting a private server OTP file, the operator explicitly
requested showing the code directly on screen for this seeded demo. Set
`OTP_DEMO_DISPLAY=true` in the API environment to enable this. It defaults to
false everywhere, including production. `OTP_DEV_EXPOSE` remains false, and
its existing production boot rejection is unchanged. Private-file delivery
continues; ordinary container logs remain redacted.

Merchant login, merchant OTP resend and admin login include the existing
optional `devOtpCode` field when the demo flag is on. Both login screens
already read this field and offer a **Use it** button; the label now says
**Demo code**. Wrong passwords still fail, and pending sessions remain
unauthenticated until OTP verification. Code generation, expiry, attempts,
rate limiting and tenant binding are unchanged. No database migration or
reseed is needed.

This is an intentional demonstration mode: a code shown alongside the
password login is not an independent second authentication factor. Remove
`OTP_DEMO_DISPLAY` or set it to false for real-use deployments.

**Since 2026-10-30 (docs/defence/02):** in production `OTP_DEMO_DISPLAY=true`
also needs `OTP_SHOW_IN_PRODUCTION=true`, or the api refuses to start; only
the exact value `true` turns it on, and the api warns at boot while it is on. The response
adds no new field names; it enables an existing optional field in the demo.

References: `apps/api/src/config.ts`, `routes/auth.ts`, `routes/adminAuth.ts`;
`apps/web/src/pages/dashboard-login/LoginPage.tsx` and
`apps/admin/src/pages/login/LoginPage.tsx`; the earlier private-file delivery
is documented in `operator-otp-file.md`.

Verification: `scripts/verify-demo-otp.mjs` runs against an explicitly
acknowledged disposable database and checks production default-off/on,
development-exposure boot rejection, wrong-password rejection, pending-session
denial, merchant login/resend/verify and admin login/verify. These passed, as
did full `npm test`, Go tests, type checking and the compiled Node build.
Existing regression-locked tests and money implementations were unchanged.
