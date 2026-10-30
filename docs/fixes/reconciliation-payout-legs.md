# Fix report: reconciliation reported every payout as a gap

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. The reconciliation report is how finance checks that every captured fil is accounted for. Any period that contained a payout showed an "unexplained" gap equal to that payout, so the report cried wolf every working day. |
| **Component** | `apps/api/src/settlement/query.ts` (`getReconciliationReport`) |
| **Found** | End-to-end check, 2026-10-30. One 47.333 BHD payment, settled and paid. Every figure was correct, but the report showed a gap of −46.268 BHD. |

## Summary

The report compares what the merchant **earned** in the ledger with what
settlement **paid**, plus what is still pending:

```
gap = ledger merchant_payable (net) − settlement net payout − pending unbatched
```

The ledger side summed every `merchant_payable` leg in the window. That
included the payout debit, which is the settlement side of the very same
comparison. PayoutBatch posts those legs when it runs, just after midnight for
the previous day, so they land in the next day's window:

- reconciling any period that contained a payout morning subtracted the payout twice, leaving a gap equal to the payout
- a same-day manual `run-batch` gave the same result inside a single day

The existing test hid it. Its helper back-dated the payout 12 hours past the
window "to mirror real timing", and it only reconciled that single day.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `api: reconciliation's ledger figure leaves out payout legs` | Payout legs (PayoutBatch and split payouts) are the only `merchant_payable` legs with a `settlement_batch_id`; the ledger figure now excludes them. |
| 2 | `test: reconciliation explains a period that contains its own payout` | Same-day payout. Fails before the fix, passes after. |
| 3 | `test: reconciliation over several days with the payout the next morning` | The daily rhythm, over one-day and two-day ranges, plus the payout day on its own. |
| 4 | `dashboard: say what the reconciliation ledger figure counts` | "Earned in the ledger (net, before payouts)", with a one-line explanation. |
| 5 | `docs: fix report for reconciliation counting payouts` | This file. |

## Verified

All reconciliation route tests pass (6). The end-to-end payment now
reconciles with a gap of 0.
