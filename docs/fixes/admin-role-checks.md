# Fix report: admin actions without the right role checks

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. Finance admins could write inside any merchant's account. A disabled admin kept merchant access. Two-person credit control checked names, not people. |
| **Component** | `apps/api/src/admin/impersonation.ts`, `apps/api/src/admin/creditApproval.ts` |
| **Reported** | "Some admin actions don't seem to have the right role checks." |
| **Date** | 2026-10-29 |

## Summary

Every admin route already has a server-side gate (`requireAdminSession`,
and `requireAdminRole("finance", "super_admin")` on the money routes), and
those gates are correct. The problems are in what the roles turn into
once checked:

1. **"View as merchant" gave finance admins write access.** Impersonation
   turns the admin's role into a merchant role, and the merchant routes'
   own role gates apply to it. Finance was mapped to the merchant
   **"finance"** role, which can create payment links, add webhook endpoints
   and so on. ADMIN.md says only **super_admin** may make changes while viewing
   as a merchant. The type even says *"merchantRole Always 'support' … a grant
   is view-only"*.
2. **A disabled admin kept their impersonation grant.** Disabling an admin
   kills their admin sessions (`sessions.ts` checks `status`), but the grant
   lookup never checked it. The comment says *"revoked_at gets set by the
   admin-disable trigger, so it's covered"*. No migration creates such a
   trigger. A disabled operator kept working inside a merchant's account
   until the grant expired.
3. **Two-person credit approval compared display names.**
   `assertDistinctApprover` checked `approver.displayName ===
   requester.displayName`. Names are free text and not unique. Two
   colleagues with the same name couldn't approve each other. An operator
   whose name had changed since the request (the requester's name is
   snapshotted on the request) could approve their own credit over the 50 BD
   limit.

The CLAUDE.md line *"the admin impersonation endpoint is gated by the
super_admin role check in middleware"* is false. Starting impersonation is
open to every admin role, which ADMIN.md intends ("support … view as a
merchant"). What the role controls is what the grant can do, and that is
what this fixes.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `admin: viewing as a merchant is read-only for finance admins` | `finance → support` in the role mapping. `support → support` and `super_admin → owner` are unchanged. |
| 2 | `admin: a disabled admin's impersonation grants stop working` | The grant lookup requires `admin_users.status = 'active'`. The false trigger comment is removed. |
| 3 | `admin: two-person credit approval compares admin ids, not names` | Compares `adminUserId`. |
| 4 | `test: admin role checks for impersonation and credit approval` | `adminRoleChecks.test.ts`, 4 tests. |
| 5 | `docs: admin role checks fix report` | This report, plus ADMIN.md now says who can change things while viewing. |

## Verification

- `adminRoleChecks.test.ts`: 4/4 pass. Against the old code, 3 fail: a finance view-as
  could create endpoints and links, a disabled admin's grant still read data,
  and same-name/renamed approvals came out the wrong way round. The
  super_admin case passes both before and after, as intended.
- `admin.test.ts`, `creditApproval.test.ts`, `credits.test.ts`,
  `adminCredits.test.ts`: 63/63 pass.

## Deploying

No migration. Live finance view-as grants lose write access on their next
request.

## Related, not changed here

- A super_admin's writes while viewing are recorded as
  `created_by_type = 'merchant_session'` with the grant id (the attribution columns only allow two
  kinds). The admin isn't named on the row itself; the grant id leads back
  to them through `admin_impersonation_grants`.
- API keys skip the merchant role check entirely (`requireMerchantRole`),
  so any key has full merchant authority. That's a documented decision (MK).
  FH raised it as an issue.
