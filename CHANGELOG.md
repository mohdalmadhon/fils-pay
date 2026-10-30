# Changelog

All notable changes to FilsPay. Dates are deploy dates (Asia/Bahrain).
Versions are the API image tag; settlement and reporting are versioned with
it. Format loosely follows Keep a Changelog.

## [Unreleased]

Hackathon work, 2026-10-29 to 2026-10-30. Not yet deployed. Every fix has a
write-up: `docs/fixes/<name>.md` or `docs/solved-problems/<nnn>.md`.

### Added
- New interface for the merchant dashboard, checkout and Ops console ("Ledger"
  design system): Ctrl+K command palette, light and night themes, and a
  Halloween costume toggle (`docs/design/README.md`).
- **Redesign:** three neo-brutalist designs, Cobalt (default; sky blue and
  lime), Lagoon (mint and coral) and Saffron (butter yellow and tomato), each
  in light and a dark, tinted dark mode, replacing "Ledger", with no purple.
  Ink outlines and hard offset shadows on every card, field and button;
  flat action colours; buttons that lift on hover; mono labels; a
  double-outlined sign-in card; the sidebar rebuilt as one set of rules. A
  Settings page in the dashboard and the Ops console chooses the design,
  light/dark/match my device, a sidebar or top-bar layout, comfortable or
  compact spacing, and the Halloween costume. Overview opens with a balance
  band and each design's own illustration (`docs/design/README.md`).
- The Halloween costume is redrawn in vector SVG: a glowing jack-o'-lantern,
  flapping bats, a ghost that haunts on its own instead of following the
  pointer, a witch, and a night scene with a haunted house, a graveyard and a
  black cat behind the page. It dresses any of the three designs.
- `scripts/e2e/payment-check.mjs`: one-command end-to-end payment check, from
  link to payout, with PASS/FAIL per step
  (`docs/verification/end-to-end-2026-10-30.md`).
- `db/migrate.integration.test.ts`: every migration must apply to an empty
  database.

### Fixed
- **Remaining capacity work:** index all branches of transaction search;
  batch webhook creation, reporting receipts and adjustment-import details;
  deliver to up to four independent webhook endpoints concurrently while
  retaining each endpoint's queue order; buffer CSV without retaining all
  decoded database rows. Compile the existing TypeScript services for Docker
  and align the API limits with 0.5 vCPU / 512 MiB. Output comparisons,
  measurements and migration 0084: `docs/perf/2026-10-30-remaining-capacity-fixes.md`.
- **Capacity follow-up:** bulk KYC and status recompute batch their writes;
  capture posts gross/fee legs together.
  Preserves review/audit history, status and money rules, and API/CSV results.
  Independent capacity measurements and comparison with the existing capacity
  commits: `docs/perf/2026-10-30-capacity-follow-up.md`.
- **Database:** a fresh `npm run migrate` stopped at 0054, so 0055–0077 never
  applied (`fresh-migrations`). Existing databases catch up with a plain
  migrate.
- **Ledger:** the scheme rounding residue (0-9 fils per exported line) is
  now journalled at batch close, as ADR 0002 required
  (`scheme-rounding-residue`). Batches closed earlier need a finance-reviewed
  back-fill.
- **Reconciliation:**
  - no longer reports payouts as a gap (`reconciliation-payout-legs`)
  - prices pending captures at the fee schedule actually in effect (`reconciliation-pending-rate`)
- **Browser apps:** the dashboards can reach the API. Adds `CORS_ALLOWED_ORIGINS` (`browser-cors`).
- **Payments and refunds:**
  - payment links: expiry is judged on the server clock (`payment-link-expiry`) and a link can't be charged twice (`payment-link-double-charge`)
  - payment-link checkout posts its negotiated discount atomically; the ledger,
    timeline, webhook and settlement agree on the net fee
    (`payment-link-negotiated-discount`)
  - concurrent refunds can't pay out twice (`concurrent-refunds`)
  - refunds don't give back more fee than was charged (`refund-fee-over-reversal`)
- **Settlement:**
  - actual net payout uses integer fils subtraction instead of float32 BD conversions (`docs/solved-problems/014-net-payout-integer-fils.md`)
  - the daily close runs at Bahrain midnight (`daily-close-timing`)
  - split payouts conserve every fil (`split-payout-rounding`)
  - payout notifications are sent once (`duplicate-payout-notifications`)
  - the balance rebuild reads the ledger (`balance-cache-rebuild-source`)
- **Webhooks and the acquirer:** signatures verify over the exact bytes sent
  (`webhook-signatures`), and acquirer callback notes are deduplicated
  (`acquirer-callback-duplicate-notes`).
- **Admin:**
  - role checks on every admin action (`admin-role-checks`)
  - API key rotation retires the old key (`api-key-rotation`)
  - status recompute leaves test merchants in test mode (`recompute-made-test-merchants-live`)
  - adjustment imports read amounts as BD with three decimals (`adjustment-import-amounts`)
- **Security:** OTP codes are no longer guessable (`otp-safety`).
- **Security review (`cyper` branch, `docs/cyper/README.md`):** 16 issues fixed,
  3 of them critical, plus a round of fixes from an independent review (18):
  - merchant login could issue another merchant's session (01)
  - reporting could read another merchant's transactions (02)
  - the hosted box ran with development defaults, so the OTP came back in the
    login response (03)
  - also: webhook SSRF (04), capture/void roles (05), the hold cleanup wiping
    the table (06), a committed secret and an open database port (07),
    suspended merchants keeping access (08), login throttling (09), card data
    in idempotency hashes (10), payment-link leaks (11), KYC uploads (12),
    hardening (13), session rotation (14), dependencies (15), unsafe agent
    guidance (16)
- **Improvements (`docs/improvements/README.md`):** 19 fixes beyond the
  security review:
  - money: net payout used `float32` (04), the platform volume counter was
    `INT4` (05), the negotiated discount was charged three ways (06), the API
    and settlement could pick different fee schedules (07)
  - `docker compose up` re-ran the seed and emptied the database (12)
  - refunds reachable at `POST /v1/merchants/:id/refunds`, and the refund
    helper checks the merchant owns the transaction (08)
  - a suspended merchant's payment link reads as `unavailable` (16)
  - signup limits and password rules (11), one least-privilege database role
    per service (13), migration checksums enforced (15)
  - the always-red tests fixed (01-03), CI added (10), Dockerfiles added (09),
    agent docs corrected (14), a browser end-to-end check (17), an
    accessibility pass with an automated check (18)
  - follow-ups from an independent review of 15-18 (19)
- **Performance:** large exports and uploads (`large-exports`), and slow reporting queries (`slow-dashboard-queries`).
- **Finance problems 001-013:** fixed and documented in `docs/solved-problems/`.
- **Future-fixes audit:** validated all 24 findings against current main;
  retained 9 existing fixes and fixed 15 remaining issues in separate commits.
  Per-problem explanations, source references, verification and migration
  requirements: `docs/audits/future-fixes-disposition.md`.
- **AI setup and submission:** how the AI assistant was set up and used
  (`ai-setup/`: standing instructions, commit and bundle helpers, offline Go
  and screenshot helpers) and `docs/SUBMISSION.md` with three annotated
  transcript excerpts. Three claims in the capacity work that were never
  measured were found while preparing it and corrected
  (`docs/perf/checkout-capacity.md`, "Corrections").
  `ai-setup/areas/` covers each part of the work (security, fixes and
  improvements, design, merging main, capacity): what was asked, how the
  assistant worked and checked, and what it got wrong; plus
  `ai-setup/scripts/settings-check.mjs`.
- **Checkout capacity:** about 38 checkouts a second on one vCPU at p95 under
  1 s, up from 10 (a 5-connection pool, an unindexed ledger lookup at every
  commit, a long lock on the merchant's balance row, reporting passes on
  every event). Past that the API turns the excess away with `503` and
  `Retry-After`, keeping throughput; services restart themselves
  (restart policies, a watchdog for a frozen API) and the API survives a
  database crash. Measured, with a crash test showing no lost or doubled
  payments: `docs/perf/checkout-capacity.md`; scripts in `scripts/load/`.
- **Merging main into UI/UX:** both lines had fixed the platform volume
  counter, the fee-schedule tie order and the negotiated discount
  independently. The write-up covers how each overlap was resolved, the
  reporting role's missing grant found afterwards, and why migrations 0080
  and 0081 each have two files: `docs/merges/2026-10-30-main-into-ui-ux.md`.

### Known issues
- Recorded in `docs/fixes/reconciliation-pending-rate.md`:
  - pricing/tier changes between capture and close can change the rate used
    at close; this audit does not introduce historical settlement snapshots
- Test failures that predate this work, listed in the verification report:
  - 2 API tests
  - 4 `RecalculateMDR` Go tests
  - 4 reporting tests
- The Dilmun Cloud deployment is not yet verified.
- Security items that need action outside the repo (rotate the acquirer
  secret, change the database password, upgrade pgx with Go 1.25, review
  the hosted box): `docs/cyper/README.md`, "Do these after merging", and
  `docs/cyper/17-open-findings.md`.

### Upgrade notes
- Run `npm install` (sharp 0.35, react-router 7) and `npm run migrate`
  (0078–0082). Before deploying the future-fixes changes, follow the coordinated
  API/settlement/reporting deployment and reviewed rebuild steps in
  `docs/audits/future-fixes-disposition.md`.
- Recreate `ops/.env.docker` from `ops/.env.docker.example`, and create
  `ops/.env` (see `ops/README.md`).
- Local development: set `OTP_DEV_EXPOSE=true` to get the OTP in the login
  response.
- Run `npm run migrate` for 0080 and 0081 too. Its first run records a
  checksum for every applied migration, and later runs refuse an edited one
  (`docs/RUNBOOK.md`).
- Add `API_DB_PASSWORD`, `SETTLEMENT_DB_PASSWORD` and `REPORTING_DB_PASSWORD`
  to `ops/.env`. The seed no longer runs on `docker compose up`; use
  `--profile seed` locally.
- Browser checks: `npx playwright install chromium` once, then
  `npm run e2e:browser` and `npm run e2e:a11y`.

## [1.9.2] - 2026-09-12

### Changed
- Volume-tier threshold updated for the platform-wide discount (d69a813).
  No pricing change for existing merchants.
- Dependency bumps across the workspace.

### Fixed
- Config: settlement now reads `DATABASE_URL` consistently with the other
  services (b64cd3c).

## [1.9.1] - 2026-08-22

### Fixed
- Duplicate `settlement.paid` webhooks (incident 2026-08-21). Receivers
  should dedupe on `Webhook-Delivery-Id`.
- Reporting worker no longer holds an extra LISTEN connection after a
  reconnect (#398).

## [1.9.0] - 2026-07-21

### Added
- Acquirer callback notes (`acquirer_callback_notes`, migration 0051) and
  signed callback verification (`inboundVerify`).
- Reporting saved filters (migration 0069).

### Security
- Inbound acquirer callbacks are now signature-checked and deduplicated.

## [1.8.0] - 2026-06-24

### Added
- Transactions CSV export (`GET /v1/transactions/export`). Streams rows, so
  it is safe for large merchants on the 512 MB container.
- KYC document thumbnails.
- Webhook delivery archive and replay for support.

## [1.7.1] - 2026-06-09

### Added
- Admin: **Import adjustments** from finance's CSV sheets (BD amounts).
- Partial-batch payout corrections in settlement (76913d3).

### Fixed
- Net payout figure now derived once per batch, so the bank instruction,
  statement and report agree.

## [1.7.0] - 2026-06-03

### Added
- Admin: **Rebuild cached balances** (finance and above). Same rebuild as the
  `settlement rebuild-balances` CLI, exposed through the internal API.
- Admin: **Recalculate MDR** for a merchant and date range.
- Payout disbursement records (migration 0057).

## [1.6.0] - 2026-05-20

### Added
- Admin credits with second-approver workflow above the threshold.
- Admin: **Rebuild analytics**.
- Platform volume tier.

### Fixed
- Incident 2026-05-14: payment links could be captured more than once when
  the acquirer re-sent a callback. Callbacks are now deduplicated on
  `callbackId`.

## [1.5.0] - 2026-05-07

### Added
- Admin: bulk KYC approve.
- Admin: Adjust balance (support).

### Changed
- README money section rewritten for new hires.

## [1.4.0] - 2026-04-28

### Added
- `transactions.refunded_fils` (migration 0043) in preparation for refunds.
- Refunds: `processRefund`, `refundValidation`, `refundState` helpers and the
  dashboard `RefundDrawer` (behind a flag).

## [1.3.2] - 2026-04-09

### Fixed
- README typo.

## [1.3.1] - 2026-03-19

### Added
- Negotiated merchant discount (`negotiated_discount_bps`, migration 0047),
  applied after MDR at capture and settlement.
- Split settlement for marketplaces.

### Fixed
- March reconciliation: scheme rounding residue swept to suspense (one-off,
  `scripts/reconcile_march.ts`). March ties out.

## [1.3.0] - 2026-03-10

### Added
- Third-decimal scheme amount on export lines (`amount_3dp`, migration 0038)
  so the residue can be posted per line.

### Removed
- `amount_3dp` reverted the same week; migration number reused for KYC
  thumbnails.

## [1.2.1] - 2026-02-24

### Fixed
- Settlement report totals (hotfix).

## [1.2.0] - 2026-02-23

### Added
- Lifetime payout estimate for monitoring (migration 0040).

## [1.1.0] - 2026-01-18

### Added
- Payment links.
- Webhooks with HMAC signatures and replay.

## [1.0.0] - 2025-12-14

First production release: merchant onboarding with KYC, card capture and
void, daily settlement in Asia/Bahrain business days, scheme file export
with residue journaled at export, reporting read model.
