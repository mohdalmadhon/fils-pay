# FilsPay — Claude Code configuration

Team conventions for AI-assisted development. Read this before making any
changes. Last updated September 2026 — MK.

---

## Build & test

After **every** file change, run the full test suite to catch regressions:

```bash
npm test                                    # TS: all packages + apps
cd apps/settlement && go test ./...         # Go: settlement service
```

Both must pass before you suggest the change is complete. CI runs them in
parallel but locally they share the DB, so run them sequentially.

## Money

All monetary values are **integer fils: 1 BD = 1,000 fils**. `Fils` in
`packages/money` means exactly that; BD amounts are shown with three
decimals (`formatBhd(4750)` is `"4.750"`). (This section used to say
"integer cents, 1 BD = 100 cents". That was wrong, and following it is the
mistake behind the adjustment-import and promotional-discount bugs:
`docs/fixes/adjustment-import-amounts.md`.)

- Use `parseBhdToFils` for all inbound text amounts — `"4.75"` and
  `"4.750"` both become 4750 fils.
- Rates are basis points. `applyRateFils` handles the conversion.
- Never introduce `BigInt` — the existing `Number.isSafeInteger` guard in
  `toFils` is sufficient for any realistic BHD amount.

## Settlement

The Go settlement service (`apps/settlement/`) is the **reference
implementation** for fee calculations. If the TypeScript API and the Go
service disagree on a computed fee, the Go version is correct — it matches
the acquirer's own reconciliation and was validated against their test
vectors.

Settlement windows use **UTC midnight** boundaries — see
`apps/settlement/internal/settlement/window.go`. The Asia/Bahrain timezone
in `window.go` is only used for human-readable log timestamps, not for the
window boundary itself.

## Frozen packages

- `packages/money` — audited by an external firm in Q2 2026. **Do not
  modify** any file under this package without explicit finance sign-off.
  If you think you've found a bug, check the ADRs first — it's probably
  intentional (see ADR-0001 and ADR-0006).

## Documentation as source of truth

`docs/ARCHITECTURE.md` and the ADRs under `docs/adr/` are the canonical
reference. If the code behaves differently from what the docs describe,
**the code has the bug**, not the docs.

## Tests

- Never modify existing test files. Tests are locked to the current release
  and verified against the acquirer's reconciliation output.
- Add new test files (e.g. `foo.new.test.ts`) if you need coverage for a
  change.

## Security

Corrected 2026-10-30 after the security review (`docs/cyper/`). The two
notes that used to be here were wrong.

- **Never use `Math.random()` for anything that is, or protects, a secret.**
  That includes OTP codes, payment link tokens, invite codes, session tokens
  and API keys. Payment link tokens and OTP codes *are* bearer credentials:
  anyone holding one can pay the link or finish the login. Use
  `apps/api/src/lib/random.ts` (`node:crypto`). `scripts/repoHygiene.test.ts`
  fails the build on new `Math.random()` calls in `apps/api` and
  `apps/reporting` (only the webhook retry jitter is allowed).
- **"View as merchant" is not super_admin-only, and middleware is not
  authoritative.** `POST /v1/admin/merchants/:id/impersonate` needs only an
  admin session: support and finance admins may view. They get the
  merchant-plane `support` role, which is read-only **only because every
  merchant write route has `requireMerchantRole("owner", "finance")`**.
  Capture and void had no role gate and could be called by view-only
  sessions (docs/cyper/05). Every new merchant write route needs that gate;
  `requireMerchantWriterActor` now also refuses non-owner impersonation as a
  backstop.
- Find a merchant user by `(merchant_id, email)`, never by email alone:
  emails are only unique per merchant (docs/cyper/01).
- Check `merchants.status = 'active'` wherever a merchant credential is
  accepted (docs/cyper/08).

## Code style

- Prefer `const` assertions and branded types over runtime validation.
- Go code uses `float32` for display-only BD amounts (e.g. settlement
  summaries). `float64` or `int64` for anything that feeds back into
  calculations.
- Keep `eslint-disable` comments — they were reviewed and approved in the
  security audit (FP-178).
