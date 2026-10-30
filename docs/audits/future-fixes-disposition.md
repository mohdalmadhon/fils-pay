# Future-fixes validation and merge disposition

Reviewed 2026-10-30 against main `44c2b04`, including the merged security
review and its follow-up fixes. The [original audit](2026-10-30-future-fixes.md)
describes main `7b69c0b`; it is retained as historical evidence, not a list of
24 currently open defects.

Of its 24 numbered findings, **9 were already fixed on main** and **15 were
confirmed and fixed in separate commits**. Each new fix has its own explanation,
affected-source references and executable regression probe below. Security
fixes already on main were retained. No frozen money package or existing
regression test was changed.

## Findings already resolved on main

These findings received no duplicate implementation:

| Finding | Checked current behavior / existing reference |
|---|---|
| 01 — Empty hold cleanup | An empty selection cannot delete all holds; deletion rechecks eligibility. [Security fix 06](../cyper/06-expire-holds-wipes-table.md). |
| 02 — Cross-merchant reporting | The requested child must belong to the authenticated merchant. [Security fix 02](../cyper/02-reporting-cross-tenant.md). |
| 03 — Wrong-merchant login | Identity lookup is scoped by merchant and email. [Security fix 01](../cyper/01-login-cross-tenant.md). |
| 04 — Float32 actual payout | Main `44c2b04` already subtracts integer fils. [Finance fix 014](../solved-problems/014-net-payout-integer-fils.md). |
| 08 — Webhook SSRF | Registration and transport use guarded destination validation. [Security fix 04](../cyper/04-webhook-ssrf.md), [review follow-ups](../cyper/18-review-follow-ups.md). |
| 13 — Browser preflight | Main configures credentialed CORS for the dashboard origins. [Browser CORS fix](../fixes/browser-cors.md). |
| 14 — Ten-minute merchant cookie | OTP completion rotates/reissues the authenticated session cookie. [Security fix 14](../cyper/14-session-rotation-and-grant-logout.md). |
| 18 — Renamed image accepted as PDF | Content detection enforces the document-type restrictions. [Security fix 12](../cyper/12-kyc-uploads.md). |
| 23 — Invalid built-in encryption key | The unsafe fallback was removed; an explicit valid key is required. Restoring a built-in key would undo the security fix. [Security fix 03](../cyper/03-insecure-defaults.md), [review follow-ups](../cyper/18-review-follow-ups.md). |

## Confirmed problems fixed here

The commit order reflects dependencies: cursor locking precedes receipts and
rebuild coordination. Each row links the problem-specific explanation and
source references, and its committed probe is under
[`scripts/future-fixes/`](../../scripts/future-fixes/).

| Finding | Confirmed behavior and resulting fix | Commit |
|---|---|---|
| [05 — Platform volume overflow](../future-fixes/05.md) | A cumulative fils counter crossed INT4 and lost the pricing tier. BIGINT storage and checked addition preserve it. | `57a8148` |
| [06 — Replayed capture discount](../future-fixes/06.md) | Counting credits cannot identify which partial capture was adjusted, especially for zero discounts. Atomic per-event completion markers prevent repeated credits. | `e8ebbb4` |
| [07 — Payable cache lifecycle](../future-fixes/07.md) | Rebuild includes captured payable; close added it again. Capture and adjustment now update the cache with their ledger movements; close records metadata. | `bec59d0` |
| [09 — Discount rounding disagreement](../future-fixes/09.md) | The 21-fil example charges a different net fee at capture and settlement. New capture snapshots use the established settlement formula for the adjustment. | `8320272` |
| [11 — Concurrent reporting](../future-fixes/11.md) | Two processes could apply the same cursor range. A transaction-held cursor lock serializes worker, catch-up and rebuild access. | `e1d431f` |
| [10 — Late-committing events](../future-fixes/10.md) | Sequence allocation is not commit order. Transactional per-event receipts keep a late lower ID eligible. | `629084e` |
| [12 — Analytics rebuild backlog](../future-fixes/12.md) | Rebuilding source totals left the included backlog eligible for replay. Rebuild coordinates with producers/worker and records receipts for included events. | `08ea7c4` |
| [15 — Manual-credit fee pricing](../future-fixes/15.md) | Confirmed the fallback-versus-effective-rate discrepancy. Issuance uses current effective pricing and freezes the fee on the request. See the narrower historical claim below. | `d565444` |
| [16 — Future-dated credit](../future-fixes/16.md) | Calendar syntax alone accepted 2099. Validation and posting reject dates after today in Bahrain. | `b8553e5` |
| [17 — Fee-schedule tie](../future-fixes/17.md) | Go ignored creation order for equal effective dates. Both services now prefer the newer creation time. | `303d84e` |
| [19 — Negative dashboard value](../future-fixes/19.md) | Formatting a valid negative reconciliation value threw. Display formatting accepts signed integer fils. | `eaa9f0e` |
| [20 — Expired stale reservation](../future-fixes/20.md) | A timed-out reservation returned active after link expiry. Public status now returns expired. | `05dce5a` |
| [21 — Endpoint deletion](../future-fixes/21.md) | Restrictive foreign keys prevented deletion after delivery/archive creation. Nullable references retain history when the endpoint is deleted. | `e54b164` |
| [22 — Disabled webhook queue](../future-fixes/22.md) | Previously queued deliveries ignored endpoint status. Disabled endpoints pause pending sends and retries without consuming attempts. | `087428f` |
| [24 — Bulk KYC state overwrite](../future-fixes/24.md) | IDs outside the review queue were approved without individual reviews. Locked review-queue selection and the canonical review path preserve other states and audit each approval. | `1bc443c` |

## Scope corrections and remaining work

- **15 is not an exact historical refund feature.** A manual credit has no
  original payment identifier, so its accounting date and amount cannot reveal
  the original charged fee. The confirmed bug is ignoring current effective
  terms when issuing the credit. Exact payment refunds remain the job of the
  transaction-linked refund engine. Existing credits were not repriced.
- **20 is a status-display defect, not an expiry bypass.** The payment path
  already rejected the expired link. An unexpired reservation still in flight
  continues to display processing.
- **09 preserves the documented settlement policy.** The frozen money helpers
  and Go fee formula were not changed. Completed historical adjustments were
  not rewritten. Unadjusted old captures without pricing snapshots retain the
  prior fee-discount calculation and are marked `legacy-fee-discount`; unmapped
  existing credits stop with `legacy_discount_review_required` for finance
  review. See [06](../future-fixes/06.md) and [09](../future-fixes/09.md).
- **Conditional CSV capacity concern:** full-result export with optional date
  bounds remains a capacity risk, not a reproduced OOM. The repository calls
  in-memory export intentional. No streaming contract or capacity policy was
  invented in this pass, and the unused timestamp-only streaming cursor was
  not activated.
- **Other original conditional concerns already addressed on main:** guarded
  webhook transport caps response consumption; suspended-merchant enforcement
  is covered by [security fix 08](../cyper/08-suspended-merchants-keep-access.md).
- **Setup:** main already fixed migration 0054/0055 failures, confirmed by the
  fresh migration check. Compose still references absent Dockerfiles and its
  startup ordering remains an operational follow-up. This merge does not claim
  a verified production or Compose deployment.
- **Separate financial follow-ups:** hosted payment-link capture still lacks
  the negotiated-discount adjustment; changes in pricing/tier between capture
  and close are not historical rate snapshots for settlement. See
  [the earlier reconciliation investigation](../fixes/reconciliation-pending-rate.md).
  This report does not claim that every repository bug has been found or fixed.
- **Webhook pausing:** a request already in flight cannot be recalled. The
  dispatcher checks status again before attempting a selected delivery, but
  disabling is not an atomic cancellation of an HTTP request.

## Migration and deployment plan

These steps describe deployment; they were not run against production.

1. Review the three migrations with the deployment/DBA owner. Pause reporting
   workers, catch-up and rebuild commands before applying
   [0081](../../db/migrations/0081_reporting_processed_events.sql); old workers
   must not advance a cursor without writing receipts after the bootstrap.
2. Apply migrations with `npm run migrate`:
   - [0080](../../db/migrations/0080_platform_volume_bigint.sql) widens the
     cumulative **fils** counter before the new settlement worker starts.
     Existing wrapped/negative history needs finance review against closed
     batches; widening alone cannot recover lost history.
   - 0081 bootstraps receipts through each existing cursor to preserve current
     rollups. This cannot distinguish events previously skipped below that
     cursor. Recover those through a reviewed reporting rebuild, not a guessed
     counter edit. Reset/rebuild now clears the corresponding receipts.
   - [0082](../../db/migrations/0082_webhook_history_survives_endpoint_delete.sql)
     retains delivery/archive rows when an endpoint is deleted.
3. Deploy API and settlement together with captures/closes paused for the
   cache-lifecycle transition. Run one reviewed `settlement rebuild-balances`
   before resuming them to remove existing drift. Rebuild also clears
   cache-only display corrections, as documented in
   [ADR 0006](../adr/0006-display-adjustments.md). No historical ledger entry
   or batch is rewritten by these fixes.
4. Deploy reporting with receipt support before resuming its consumers. An
   admin analytics rebuild now locks the cursor and temporarily blocks outbox
   producers while taking its source snapshot; schedule large rebuilds with
   that blocking behavior in mind.

## Verification

All checks used local disposable PostgreSQL databases. A freshly migrated and
seeded template was cloned separately for final suites and for the new probes;
no production or shared development financial records were altered. The local
verification server is PostgreSQL 18.6; the deployment architecture targets 16.

| Check | Result |
|---|---|
| All 15 new `.verify.mjs` probes, together on a fresh database copy | Pass |
| `npm run typecheck` | Pass |
| `node --import tsx --test db/migrate.integration.test.ts` | Pass; all migrations apply to an empty database |
| `node --import tsx --test scripts/*.test.ts` | 10/10 pass, including repository security hygiene |
| Events / money / web existing suites | 4/4, 40/40, 8/8 pass |
| Existing API suite | 516/518 pass; two failures also present before these changes |
| Existing reporting suite | 7/11 pass; the same four failures as baseline |
| `go test ./...` | Four existing `RecalculateMDR` failures remain; other packages pass |

Full npm and Go checks were run for each problem commit. Repeated runs on the
initial disposable database accumulated webhook fixtures, so the final counts
above come from a fresh database copy. The initial baseline also had an
analytics query-plan assertion failure that did not recur on the fresh copy;
this is not credited as a fix here.

The remaining API failures are the historical latest-entered-fee-schedule
expectation and webhook backoff/exhaustion timing. Reporting failures cover
rebuild replay, capture and batch-close ingestion, and atomicity, with the same
seeded-payload/fixture failures as baseline. The four Go failures are
`TestRecalculateMDR_RecomputesAtCurrentRate`,
`TestRecalculateMDR_AdjustmentLedgerGroupBalances`,
`TestRecalculateMDR_UnchangedRateAdjustsNothing`, and
`TestRecalculateMDR_OutOfRangeBatchUntouched`; their finalized-batch expectations
predate [ADR 0008](../adr/0008-mdr-finalized-batches.md). They were not changed
to manufacture a green run. The complete suite is **not green**.

New probes exercise actual application functions and SQL, including a real
capture/rebuild/close/payout, concurrent adjustment replay, late commits,
cursor contention, rebuild followed by backlog consumption, retained webhook
history, pause/resume, and concurrent KYC approval. Run only against a
disposable migrated/seeded database: several probes commit fixture rows, and
the lifecycle probe invokes a full balance rebuild.

```bash
# Set DATABASE_URL and the normal required application environment for that
# disposable database. Do not use a production database.
for probe in scripts/future-fixes/[0-9][0-9].verify.mjs; do
  node --import tsx "$probe" || break
done
npm test
(cd apps/settlement && go test ./...)
npm run typecheck
node --import tsx --test db/migrate.integration.test.ts
node --import tsx --test scripts/*.test.ts
```

Local full-suite logs for this session are under
`/tmp/filspay-future-checks/` (`baseline-*`, each finding number, and `final-*`).
They are temporary artifacts; the results, source references and executable
probes above are the durable record.
