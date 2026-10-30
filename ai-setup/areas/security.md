# AI in the security review

Branch `cyper`, 29-30 October 2026. Results: [`docs/cyper/`](../../docs/cyper/README.md).

## What I asked

A defensive security review of the whole monorepo, then: "fix all these
issues but remember to document everything and where u found the issue and
what was the fix", with my standing rules (no push, my name only, five
commits per issue; [`../instructions.md`](../instructions.md)).

## How the assistant worked

- **Read everything an attacker could touch**: authentication and sessions,
  tenant isolation, injection, uploads, outbound requests (SSRF), secrets,
  logging, configuration and deployment, dependencies, and the git history.
- **Proved findings before fixing them.** Most reports start with a commit
  that adds a test failing on the vulnerable code; for the login finding
  ([01](../../docs/cyper/01-login-cross-tenant.md)), a test that signs in to
  another merchant's account with only the victim's email and your own
  password. The fix commits make it pass.
- **Five commits per finding**: usually the failing test, the fix in
  steps, then the report. Each report says where the problem was, what was wrong, the fix,
  how it was verified, and what someone with server access must still do
  (rotate the leaked acquirer secret, change the database password).
- **Checked the whole system after**, on a fresh database: migrate and seed,
  typecheck, the API test suite, `npm run audit:prod`, and the end-to-end
  payment check (`scripts/e2e/payment-check.mjs`, 20 passed).
- **Was honest about what it didn't fix**: [`17-open-findings.md`](../../docs/cyper/17-open-findings.md)
  lists them with reasons (an upgrade needing a newer Go, history that
  can't be trusted, production data in `docs/exports/`).

## Tools and checks

| | |
|---|---|
| Reading and search | the repo and its full git history |
| Proof | a failing test per finding (API tests against a real Postgres) |
| Dependencies | `npm audit` (four vulnerable packages found and upgraded; one Go upgrade documented as not possible here) |
| End to end | `scripts/e2e/payment-check.mjs`: create a link, pay it, follow the money through ledger, settlement and payout, verify webhooks |
| Second opinion | a separate reviewer that had not seen the work read the finished diff ([18](../../docs/cyper/18-review-follow-ups.md)) |

## The AI's own files were part of the attack surface

[`16-unsafe-agent-guidance-and-invite-codes.md`](../../docs/cyper/16-unsafe-agent-guidance-and-invite-codes.md):
the repo's `CLAUDE.md` and `AGENTS.md`, which AI coding tools read before
changing code, told them `Math.random()` was fine for payment-link tokens
and OTP codes and that an admin-impersonation check existed when it didn't.
One file had already followed that advice (admin invite codes from
`Math.random()`). The assistant treated those files as claims to check, not
instructions, fixed the guidance, and added a repo test that fails if
`Math.random()` appears where secrets are made.

## What it got wrong, and how that was caught

The independent review ([18](../../docs/cyper/18-review-follow-ups.md))
found that the assistant's own login rate limit (fix 09) could be bypassed
two ways, both reproduced:

- the same merchant id spelled differently (upper case, braces, no
  hyphens) got a fresh failure budget each time;
- 20 parallel guesses all passed a limit of 4, because the count was read
  before the slow password check and written after it.

It also found the assistant had broken the compose seed job and scoped a
migration too narrowly. All were fixed in a further five commits. The
lesson kept for the rest of the work: a fix written and tested by the same
author needs a reader who didn't write it.

## Read more

- Index of all 18 reports and the after-merge steps: [`docs/cyper/README.md`](../../docs/cyper/README.md)
