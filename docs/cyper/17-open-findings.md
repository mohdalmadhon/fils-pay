# 17: Open findings (recorded, not fixed)

These came out of the same security review. Each one needs a decision, access,
or a change outside this repository, so it is recorded here rather than fixed.
Ordered by severity.

## 1. Repository history can't be trusted as a record of who wrote what (High)

**What was found**

- **Commit `098c2de`** ("minor cleanup and doc edits") is authored as Yousif
  Al-Ansari on **2026-09-28**. `docs/HANDOVER.md` gives his last day as
  **2026-04-09**. Its committer is `placeholder <p@x>`. It adds one file,
  `db/seed/fixtures/transactions.ts` (476 lines). The message describes
  something else.
  - The file was reviewed line by line. It is deterministic data generators
    for seed fixtures (`createHash` for stable UUIDs, no I/O, no network, no
    `eval`; it imports only `node:crypto`, `@filspay/money` and the seed's
    own `rng`). No backdoor
    was found.
  - The problem is the identity: someone committed under a departed
    employee's name, with a misleading message, after he left.
- **All 41 earlier team commits** (Yousif, Mahmood, Fatima, Ali, from the
  2025-08-03 bootstrap onward) have the committer `placeholder <p@x>`. The
  history was recreated or imported, so author names and dates are claims, not
  evidence.
- **Signatures.** 50 commits by `malmadhoo` carry an SSH signature. Every
  other commit, including the whole team history and the 80 commits of this
  review, is unsigned. This clone has no `gpg.ssh.allowedSignersFile`, so not
  even the signed ones can be verified here.
- **No branch protection or CI in the repo.** There is no `.github/`
  directory: no required reviews, no required checks, no CODEOWNERS.
- **Commit `0af74f0`** ("dead man's switch", Yousif, 2026-04-09) carries an
  encrypted payload ("transmission 3 of 3", `openssl enc -aes-256-cbc -pbkdf2`)
  and the text "If nobody asks where I went, this stays shut." It wasn't
  decrypted; the passphrase isn't known. It changes no code.

**Recommendation**

1. Ask Yousif (or HR, through his former manager) whether he made `098c2de`.
   If not, find out who has had push access since April.
2. Turn on branch protection for `main`: required review, required status
   checks (`npm test`, `go test`, `npm run audit:prod`), no force-push.
3. Require signed commits. Publish an `allowed_signers` file so signatures can
   be verified, and sign the cyper commits when merging.
4. Treat `0af74f0` as a people matter, not a code one. Raise it with
   whoever handled his exit.

## 2. Production data is committed under `docs/exports/` (Medium)

`docs/exports/*.csv`, labelled production in their README, contain staff
emails and roles, merchant IDs and names, payout amounts, and API key
prefixes (`fp_live_8be56d…`). There are no full keys, card numbers or webhook
secrets.

**Recommendation:** move them out of the repo to wherever finance keeps
records, delete them here, and purge them from history if the repo is ever
shared outside the team.

## 3. pgx (Go) needs an upgrade that needs Go 1.25 (High)

See [15](15-vulnerable-dependencies.md#not-fixed-pgx-go-settlement).
CVE-2026-33816 is rated critical; the fix (pgx 5.9.0+) requires Go 1.25, which
couldn't be built or tested here.

## 4. Email ownership is never verified (Medium)

Signup accepts any email without confirmation, and emails are only unique per
merchant. [01](01-login-cross-tenant.md) removed the way this enabled account
takeover, but anyone can still open a merchant in someone else's name. Add an
email confirmation step before a merchant goes active.

## 5. Seeded credentials on a hosted box (Medium)

`db/seed` creates `superadmin@filspay.test` and merchant owners with passwords
that are in the repo. Combined with [03](03-insecure-defaults.md) this was a
password-only super admin login. **Recommendation:** refuse to run the seed
when `NODE_ENV=production`, or generate random passwords and print them once.

## 6. One database role for everything (Medium)

The API, settlement, reporting, migrate and seed all use the role that owns
the database (a TODO in compose says "give the api its own role before
anything is hosted"). Any SQL injection or credential leak in one service is
full control of all data. **Recommendation:** an owner role used only by
migrations, plus per-service roles with only the grants each needs.

## 7. Audit attribution for super_admin writes (Low)

A super_admin writing while viewing as a merchant is recorded as
`merchant_session` with the grant id. Details in
[05](05-capture-void-roles.md#open).

## 8. Smaller items (Low)

- **Settlement internal API** listens on all interfaces. Compose doesn't
  publish its port and it needs a bearer token, but binding to the private
  network interface would be safer.
- **KYC PDFs** are served `inline` to admin reviewers. Consider `attachment`,
  or a separate origin, so a hostile PDF never runs in the admin console's
  origin. PDF/JPEG polyglots are still accepted ([12](12-kyc-uploads.md#not-changed)).
- **Signup has no rate limit.** Login is now throttled ([09](09-login-rate-limit.md));
  `POST /v1/merchants` isn't.
- **The Dockerfiles compose refers to** (`ops/Dockerfile.node`,
  `ops/Dockerfile.go`) aren't in the repo, so whether the containers run as
  root couldn't be checked.
- **Dilmun Cloud** (the hosting) couldn't be inspected. Everything in
  [03](03-insecure-defaults.md#after-deploying) and
  [07](07-committed-secrets-and-open-database.md#after-merging) under "after
  deploying/merging" needs doing there.
