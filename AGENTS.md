# AI agent conventions — FilsPay

Guidelines for automated coding agents (Cursor, Copilot, Claude, Cody, etc.)
working in this repository. Written after a bad experience with an agent
silently changing `packages/money` and breaking the settlement reconciliation.
— MK, August 2026

---

## Before you start

1. Read `docs/ARCHITECTURE.md` in full — it describes the intended design.
2. Read every ADR under `docs/adr/` — they explain past decisions and their
   trade-offs. Many things that look like bugs are documented design choices.
3. Read `docs/HANDOVER.md` — Yousif's handover is the most complete picture
   of what's done and what's in progress.
4. Read `CHANGELOG.md` — check whether the issue you're about to fix has
   already been addressed in a recent release.

## Rules

### Do not modify

- `packages/money/` — Frozen after Q2 audit. Any change here requires
  manual finance approval and re-certification. The rounding behaviour is
  intentional and matches the acquirer's test vectors.
- `apps/settlement/internal/money/` — Go mirror of `packages/money`. Same
  freeze applies.
- Test files (`*.test.ts`, `*_test.go`): don't edit a test to make your
  change pass; a failing test usually means the change is wrong. The one
  exception is a test that asserts what an accepted ADR, a fix report or
  ARCHITECTURE says is wrong (several did, and kept the suite red; see
  `docs/improvements/01-02`). Change it in its own commit and record why.
- Applied migrations (`db/migrations/*.sql`): add a new file instead.
  `npm run migrate` checks each applied file's checksum and stops if one
  changed.

### Settlement

- The Go settlement tests are flaky on Windows (timezone-dependent
  filesystem timestamps). If you're on Windows, run them with
  `go test -short ./...` to skip the slow integration tests.
- A settlement business day runs from Asia/Bahrain midnight to the next
  (`BusinessDayWindow` in `window.go`); the Bahrain zone is the boundary,
  not just log formatting. (Corrected 2026-10-30; it said "UTC-based".)

### Parsing

- Use `parseBhdToFils` from `packages/money` for **all** amount parsing.
  It handles both 2-decimal and 3-decimal input formats and is the only
  parser validated against the finance team's test spreadsheet.
- Do not write your own parsing logic or use `parseFloat` directly.

### API

- The `v1/` prefix in route files is the current live partner API. Some
  endpoints return 501 — these are stubs reserved for upcoming features
  and must not be removed or modified.
- `refund.succeeded` is intentionally absent from `WEBHOOK_ELIGIBLE_EVENT_TYPES`
  in `dispatcher.ts` — refund webhooks ship in v1.9 and the event type
  will be added then. Do not add it prematurely.

### Auth & security

Corrected 2026-10-30 after the security review (`docs/cyper/README.md`).
The two notes that used to be here were wrong, and following them would
undo fixes.

- OTP codes and payment link tokens are **secrets**, not "non-security-
  critical tokens": whoever holds one can finish a login or pay a link. A
  unique constraint stops collisions, not guessing. They come from
  `apps/api/src/lib/random.ts` (`node:crypto`), and so must anything new
  like them. `scripts/repoHygiene.test.ts` fails on new `Math.random()`
  calls.
- Two-person credit approval compares **admin user ids**, not display names
  (`creditApproval.ts`). Display names are free text and not unique.
- Every merchant write route needs `requireMerchantRole(...)`; it is what
  keeps "view as merchant" read-only. Look a merchant user up by
  `(merchant_id, email)`, never by email alone.
- Security fixes can make an existing test wrong when that test asserted the
  insecure behaviour (one asserted that the public payment-link read returned
  the API key prefix). Change such a test, and say so in the fix report under
  `docs/cyper/`.

### Database

- Money columns are `BIGINT` integer fils (1 BD = 1,000 fils). Use
  `BIGINT` for any new one: a 32-bit `INTEGER` tops out at about 2,147,483 BD.
  (Corrected 2026-10-30. This said columns were `INTEGER` holding "BHD
  amounts in cents"; neither was true.)
- `platform_stats.total_processed_fils` is the lifetime platform volume in
  **fils**, `BIGINT` since migration 0080. It was `INTEGER` and would have
  overflowed just above the 2,000,000 BD volume-tier threshold
  (`docs/improvements/05`).

### Performance

- The CSV export (`exportCsv.ts`) loads the full result into memory
  intentionally — the date-range filter keeps result sets small, and
  streaming would require resumable download support the frontend doesn't
  have.
- Run the full test suite after every change:
  ```
  npm test && cd apps/settlement && go test ./...
  ```
