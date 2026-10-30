# Verification

End-to-end checks of what FilsPay actually does with money, run against real
services, and their results. Each report records:

- what was asked
- how it was checked
- the results before and after any fixes
- the test-suite state
- what remains open

| Date | Report | Scope |
|---|---|---|
| 2026-10-30 | [end-to-end-2026-10-30.md](end-to-end-2026-10-30.md) | One payment, from link through ledger, fees, settlement and payout, webhooks, timeline, reports and reconciliation. Found and fixed four problems. Dilmun Cloud deployment not yet verified. |

To repeat a check, run `scripts/e2e/payment-check.mjs`. How to run it is in
the report.
