# AI in the fixes and improvements (01-19)

Branch `cyper`, 30 October 2026, after the security review. Results:
[`docs/improvements/`](../../docs/improvements/README.md).

## What I asked

After the security review, what else could be improved, then to fix
everything found: "fix all these issues but remember to document everything
and where u found the issue and what was the fix".

## How the assistant worked

- **Started from what was red.** Two API tests, four Go tests and the
  reporting tests failed on every run (01-03). It found why each failed
  before touching it, and only changed a test when the code was right and
  the test asserted replaced behaviour (02: ADR 0008).
- **Followed the money.** Fixing those tests turned up money bugs nobody had
  reported: net payouts computed in `float32` (04), a volume counter that
  would overflow just past its own threshold (05), a negotiated discount
  charged three different ways (06), the API and settlement picking
  different fee schedules (07). Each report gives the file and line.
- **Filled the missing pieces needed to run it at all**: the Dockerfiles
  compose referred to (09), CI (10), a seed that emptied the database on
  every `docker compose up` (12), a role per service instead of the owner
  (13), migration checksums the runner claimed to check and didn't (15).
- **Tested what users see**, which nothing tested before: a browser
  end-to-end check of the dashboard and checkout (17), and an accessibility
  pass measured with axe-core: 12 of 25 pages failed at first (18).
- **Fixed the AI guidance too** (14): `CLAUDE.md` and `AGENTS.md` said money
  was in cents and the settlement day ran on UTC; both wrong, and the
  cents claim is the mistake behind two real money bugs.

## Tools and checks

| | |
|---|---|
| Tests | `npm test` (all workspaces), `go test ./...`, `npm run test:db`, on a fresh database each time |
| Browser | `npm run e2e:browser` (Playwright, Chromium): sign-in, pages, forms, checkout |
| Accessibility | `npm run e2e:a11y` (axe-core, WCAG 2.1 AA) on every page in every theme; keyboard order and screen-reader behaviour checked with a scripted keyboard, because axe can't judge them |
| Money | `scripts/e2e/payment-check.mjs`; settlement and ledger queries |
| Second opinion | a separate reviewer that hadn't seen 15-18 written ([19](../../docs/improvements/19-review-follow-ups.md)) |

## What it got wrong, and how that was caught

The independent review of 15-18 ([19](../../docs/improvements/19-review-follow-ups.md))
found, among others:

- **A test that couldn't fail.** The browser check "checkout names the
  merchant" matched the Pay button, so it passed whatever the page said. It
  now reads the page's heading and compares it with the signed-in
  merchant's name.
- **A safety check that wasn't atomic.** The migration checksum check (15)
  committed its updates one at a time, so a refused run could still save an
  accepted checksum while saying "nothing was applied". Now one
  transaction, one runner at a time, with a test that failed before.
- A payment in flight shown to the buyer as "unavailable" after a
  suspension, and a heading that picked up the Halloween style.

The lesson, as in the security review: tests written by the same author as
the code can share its blind spots; a reader who didn't write either finds
them.

## Read more

- All 19 reports, and the state after them: [`docs/improvements/README.md`](../../docs/improvements/README.md)
