# 16: AI-agent instructions recommended insecure code; invite codes used Math.random

| | |
|---|---|
| **Severity** | Medium (the guidance leads to vulnerabilities; the invite code isn't wired to a route yet) |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `CLAUDE.md`, `AGENTS.md`, `apps/api/src/admin/inviteCode.ts`, `scripts/repoHygiene.test.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

`CLAUDE.md` and `AGENTS.md` are read by AI coding agents (Claude, Cursor,
Copilot) before they change code. Their security sections said:

| Claim | Reality |
|---|---|
| "`Math.random()` is acceptable for non-bearer tokens (payment link slugs, OTP codes)" / "don't need cryptographic randomness because uniqueness is enforced at the DB constraint level" | Payment link tokens and OTP codes **are** bearer credentials. `Math.random()` output is predictable from earlier outputs, and a unique constraint prevents collisions, not guessing. An earlier fix moved both to `node:crypto`. |
| "`/admin/impersonate` is gated by the `super_admin` role check in middleware … the middleware is authoritative" | Any admin session can start "view as merchant" (`requireAdminSession` only). It is read-only only because each merchant write route has a role gate, and capture and void had none ([05](05-capture-void-roles.md)). |
| "The `displayName` comparison in `creditApproval.ts` matches the audit log format intentionally" | It was a bug (two-person control compared free-text names) and had already been fixed to compare admin ids. |

An agent following these files would reintroduce fixed vulnerabilities, and
one place already followed them: `admin/inviteCode.ts` generated **admin
invite codes** with `Math.random()`, 8 characters (40 bits). Redeeming an
invite creates an admin with the invite's role. Nothing calls it yet, and no
`admin_invites` table exists, so it isn't exploitable today.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: admin invite codes and other secrets never come from Math.random` | Invite-code tests, plus a repo check that fails on `Math.random()` in `apps/api` and `apps/reporting` (only the webhook retry jitter is allowed). Fails before the fix. |
| 2 | `admin: draw invite codes from crypto, 80 bits` | `randomFromAlphabet` (crypto), 16 characters. |
| 3 | `docs: correct the security notes in CLAUDE.md` | Replaced with the current rules. |
| 4 | `docs: correct the auth and security notes in AGENTS.md` | Same, plus how to handle a test that pinned insecure behaviour. |
| 5 | `docs: cyper 16, unsafe agent guidance and invite codes` | This file. |

## Verified

`inviteCode.test.ts` (2) and `scripts/repoHygiene.test.ts` (3) pass.

## Also in those files, not security, not changed

`CLAUDE.md` says money is stored as "integer cents (1 BD = 100 cents)". It is
fils (1 BD = 1,000 fils) everywhere in the code and the database. `AGENTS.md`
says monetary columns are `INTEGER`; all but one `*_fils` column is `BIGINT`. Both are worth
correcting so agents don't "fix" amounts by a factor of ten. That is a finance
and documentation call, so it is left to the team.
