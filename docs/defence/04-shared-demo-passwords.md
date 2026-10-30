# 04: Every demo account got the same password, so one demo login opened all of them, super admin included

**Severity:** High on the hosted demo. Anyone handed one demo login, say
the support admin's, could sign in as the super admin. Any merchant could
sign in as every other merchant.

**Area:** deployment (`ops/remote-deploy.sh`) and demo data
(`db/seed/replaceDemoPasswords.ts`).

## How it was tested

1. Ran `replaceDemoPasswords.ts` on a seeded scratch database. Result: 15
   merchant users with **1** distinct password hash, and 3 admins with
   **1**.
2. Started the API with the deploy's settings: production, sign-in codes
   shown on screen.
3. Signed in as `superadmin@filspay.test` with the shared admin password and
   the code from the response. `/v1/admin/auth/me` answered
   `{"role":"super_admin"}`.
4. Signed in with the shared merchant password as the owner of a different
   seeded merchant (Seef Kiosk). Answer: `{"authenticated":true,"role":"owner"}`.

The seed's merchant ids and emails are fixed and already in the repo (for
example in `docs/exports/*.csv`), so they are no barrier.

## Why it happened

The script was written to stop *public* passwords from working: the seed's
passwords are in this repo. It generated one password per table and set it
on every matching account with
`UPDATE ... WHERE id = ANY(...)`, so all the accounts still shared a single
secret. With codes shown on screen, sharing a password means sharing the
account.

## Fix

- **One password per account.** Every account still on a public demo
  password gets its own random one: 16 characters from an unambiguous
  alphabet, plus a symbol and a digit.
- **One printed line per account.** The output says whose password each is:
  - `merchant user owner@alpharetail.example at Alpha Retail Co (9972daab-...): <password>`
  - `admin superadmin@filspay.test (super_admin): <password>`
- **Same storage and rerun behaviour.** The deploy still keeps the output in
  the owner-only `~/fils-pay-config/demo-passwords.txt`, and running it
  again still changes nothing.
- **Docs.** `docs/deploy.md` and `ops/README.md` (including its end-to-end
  check command, which now picks the owner's own line) describe the new
  format.

**A server that was already deployed** keeps its shared passwords, because
the script only replaces the public seed passwords. To rotate them,
re-seed it (`SEED=1`), which restores the seed passwords and then replaces
them, or set new passwords by hand.

## Test

`db/seed/replaceDemoPasswords.integration.test.ts`, which is now in
`npm run test:db`. It uses 4 merchant users and 3 admins on the public
passwords, plus 1 user with their own password. It checks that:

- 7 accounts are replaced, with 7 different passwords;
- each password opens its own account and no other;
- the user with their own password is untouched;
- a second run changes nothing.

Before the fix the function didn't exist as a testable unit; the shared
password was reproduced by the probe above.
