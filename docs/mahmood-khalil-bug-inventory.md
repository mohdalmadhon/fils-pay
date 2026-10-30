# Bugs attributed to or defended by Mahmood Khalil (MK)

Reviewed 2026-10-30 against main `44c2b04`, the `future-fixes` audit, Git
history, and the linked investigation records. **MK means Mahmood Khalil.**

This is an evidence inventory, not a claim about intent or sole personal
responsibility. “Introduced” below means the relevant implementation is in a
commit whose recorded author is Mahmood Khalil. “Defended” means a comment,
decision or incident record explicitly attributes the assurance to MK;
it does not mean he wrote the faulty implementation. The
[history review](cyper/17-open-findings.md#1-repository-history-cant-be-trusted-as-a-record-of-who-wrote-what-high)
explains why the imported author metadata is not independently reliable.
These are the supported associations found in the reviewed material, not a
guarantee that every defect in the repository has been discovered.

“Fix documented” refers to a repository implementation/write-up, not proof
of deployment or historical data repair. Old reports sometimes say
“uncommitted” or “not pushed”; those are historical descriptions.

## Implementations attributed to Mahmood Khalil

- **A01 — Actual payouts lose fils through float32 conversion.**
  `baa58132` introduced `NetPayableFils`, which converted integer gross and
  fees to float32 BD and rounded back. A net of 97,500,001 fils became
  97,500,000; other amounts can round upward. **Fix documented:** direct
  integer subtraction. [Investigation and references](solved-problems/014-net-payout-integer-fils.md).

- **A02 — Lifetime payout monitoring loses precision.**
  `baa58132` introduced the monitoring helper's float32 conversion and
  approximate accumulation. The corresponding database counter also used
  REAL. This is distinct from A01: it is a monitoring counter rather than
  the payout instruction. **Fix documented:** integer-fils accumulation and
  a BIGINT migration. [Problem 009](solved-problems/009-lifetime-payout-estimate.md).

- **A03 — Split payouts fail to conserve the parent's net.**
  `a5bfdc6a` introduced independent child-share rounding. Rounded child
  amounts did not always sum to the parent's payout. **Fix documented:**
  validated weights, largest-remainder allocation and exact conservation.
  [Problem 002](solved-problems/002-split-payout-allocation.md).

- **A04 — Platform volume wraps negative and changes fee eligibility.**
  `a5bfdc6a` introduced an int32 accumulator and batch narrowing conversion.
  Adding 100 to 2,147,483,640 produces -2,147,483,556 before the database
  write, potentially removing the volume-tier discount. **Open in the
  reviewed code.** [Accumulator](../apps/settlement/internal/settlement/platform_volume.go),
  `future-fixes` audit finding 05. The old database guidance also defended
  INT4 with the incorrect claim that this counter represented BD, not fils.

- **A05 — Capture and settlement discount different rounded values.**
  `baa58132` introduced the settlement discount formula: discount gross,
  then calculate MDR. Capture discounts the rounded MDR fee. At 21 fils,
  250-bps MDR and a 1,250-bps discount, the two produce different fees.
  MK also defended the asserted parity at the June engineering sync.
  **Open, recorded in the changelog.**
  [Settlement formula](../apps/settlement/internal/settlement/discounted_fee.go),
  [June meeting](meetings/2026-06-02-eng-sync.md#3-settlement-v2),
  [fee investigation](fixes/reconciliation-pending-rate.md#found-along-the-way-not-changed-here).

- **A06 — CSV imports misread Bahraini dinars by a factor of ten.**
  `43073e5e` introduced the importer/parsing implementation. `4.75` posted
  475 instead of 4,750 fils, and a third decimal could be discarded.
  MK's `6f462e1` message calls the import amounts intentional after YA's
  warning. **Fix documented:** validated three-decimal BD parsing.
  [Problem 006](solved-problems/006-adjustment-import-bhd-parsing.md).

- **A07 — Large adjustment uploads fail before reaching the importer.**
  `43073e5e` introduced the route under Fastify's default 1 MB limit. Larger
  uploads returned 500 in the documented reproduction; rows per import
  were also unbounded. **Fix documented:** explicit byte and row limits.
  [Large-export/upload report](fixes/large-exports.md).

- **A08 — Re-uploading an adjustment CSV posts real money twice.**
  `43073e5e` introduced an importer without a stable operation key or content
  deduplication. MK's route comment says finance checks the spreadsheet and
  that this is fine for now. The finance archive records an actual repeat
  import and MK acknowledging the second posting is real. **Known open
  operational risk, explicitly documented for operators.**
  [Import route](../apps/api/src/routes/adminAdjustmentImport.ts),
  [September 4 thread](archive/slack-export-fp-finance-2026-09.txt),
  [operator warning](ADMIN.md#money). No claim is made that the reported
  reversal was correct or incorrect without examining its postings.

- **A09 — Two-person credit approval compares names instead of identities.**
  `43073e5e` introduced `creditApproval.ts`. Free-text display-name comparison
  blocked distinct people sharing a name and could permit self-approval
  after a name change. Earlier agent guidance defended the comparison as
  intentional. **Fix documented:** compare admin user IDs.
  [Admin-role report](fixes/admin-role-checks.md),
  [unsafe-guidance report](cyper/16-unsafe-agent-guidance-and-invite-codes.md).

- **A10 — Manual credits reverse the fallback fee instead of actual terms.**
  `43073e5e` introduced credit fee reversal based on `merchants.mdr_bps`,
  without the effective schedule, negotiated discount or volume tier used
  for processing. **Open in the reviewed implementation.**
  [Credit implementation](../apps/api/src/admin/credits.ts),
  `future-fixes` audit finding 15. This is not the separate refund-fee fix.

- **A11 — Future-dated credits affect the current cached balance.**
  `43073e5e` introduced validation that checks calendar syntax but does not
  enforce its promised today-or-earlier bound. A future effective date is
  accepted while posting updates the cache immediately. **Open in the
  reviewed implementation.** [Validation](../apps/api/src/admin/creditRequestValidation.ts),
  [posting](../apps/api/src/admin/credits.ts), audit finding 16.

- **A12 — Slow payment-link reservations permit more than one charge.**
  `6a076df1` introduced the original payment-link flow. An expired
  reservation could be taken over while its first capture was still
  running; both buyers could be charged. MK repeatedly defended the claim
  and blamed callbacks. **Fix documented:** reservation ownership tokens
  and capture/finalization under one link-row lock.
  [Double-charge report](fixes/payment-link-double-charge.md),
  [incident correction](incidents/postmortem-2026-05.md#addendum-2026-10-29-the-root-cause-above-was-wrong),
  [operations archive](archive/slack-export-fp-ops-2026-05.txt).

- **A13 — Buyers can backdate payment-link expiry checks.**
  `6a076df1` introduced the client-time path. The public pay endpoint trusted
  `submittedAt`, allowing a backdated request to pay an expired link. MK's
  migration comment described the offline-terminal reason, and his status
  comment accepted read/pay disagreement. **Fix documented:** database
  time determines expiry. [Expiry report](fixes/payment-link-expiry.md).

- **A14 — One merchant can cancel another merchant's payment link.**
  `6a076df1` introduced cancellation that did not constrain the target
  update and error lookup by the authenticated merchant. **Fix documented:**
  scope both queries by merchant and link ID.
  [Problem 011](solved-problems/011-payment-link-cancel-ownership.md).

- **A15 — Expired stale reservations are displayed as active.**
  `6a076df1` introduced public-status derivation that checks expiry for
  active rows but ignores it in the reserved-row branch. **Open at review;**
  the payment submission itself correctly rejects expiry after A13's fix.
  [Status helper](../apps/api/src/paymentLinks/status.ts), audit finding 20.

- **A16 — Public payment-link reads disclose API-key metadata.**
  `6a076df1` introduced the public read implementation. It disclosed an API
  key prefix and its SHA-256 verifier. This was unnecessary exposure, not
  disclosure of the full raw API key. **Fix documented:** remove both fields
  and their key lookup. [Security report 11](cyper/11-payment-link-leaks.md).

- **A17 — Webhook archive creation/restoration loads the entire archive.**
  `5f4d8cf3` introduced archive handling that built one large JSON value in
  API memory, despite claims about paging and compression. Large histories
  could exceed memory/string/database-field limits. **Fix documented:**
  archive entries and copy/restore operations inside PostgreSQL.
  [Large-export report](fixes/large-exports.md).

- **A18 — Transaction CSV export has an unbounded memory path.**
  `7310bc38` introduced the export implementation. The active route loads
  all matching rows into memory; optional date bounds do not guarantee a
  small result. MK-authored agent guidance defended that assumption.
  **Conditional capacity risk, not a reproduced OOM.** The unused streaming
  helper also has a timestamp-only cursor that can skip ties if activated
  unchanged; that is not claimed as a live-route data-loss bug.
  [Export source](../apps/api/src/transactions/exportCsv.ts), audit additional
  concerns. A17's archive fix did not fix this export path.

## Other bugs explicitly defended or dismissed by MK

- **B01 — Scheme file amounts round upward while integer amounts truncate.**
  MK described the decimal column as an acquirer display figure and blamed
  BIN-range rounding, although the platform generated the discrepant file.
  **Fix documented:** derive both stored representations from the same
  truncated fils. [Problem 001](solved-problems/001-scheme-export-rounding.md),
  [September 8–10 finance thread](archive/slack-export-fp-finance-2026-09.txt).

- **B02 — Admin balance rebuild uses a different financial quantity from CLI.**
  MK selected the faster scheme-export source in ADR 0004 and claimed the
  button and ledger CLI were equivalent. It ignored fees, payouts and
  unbatched ledger activity. **Fix documented:** shared ledger rebuild.
  [ADR 0004](adr/0004-balance-rebuild-source.md),
  [rebuild investigation](fixes/balance-cache-rebuild-source.md).

- **B03 — MDR recalculation rewrites closed and paid batches.**
  The finance thread records MK saying the paid figure stayed unchanged;
  a test comment called historical rewriting intended. The implementation
  changed finalized totals. **Fix documented:** open-batch previews only.
  [Problem 004 and reference trail](solved-problems/004-mdr-finalized-batches.md).

- **B04 — Callback redeliveries create duplicate fraud-review notes.**
  MK claimed `processed_events` and a deployed dedupe fix existed. Neither
  did in the investigated implementation. These callbacks write notes;
  they were not the cause of A12's double captures. **Fix documented:**
  composite uniqueness and conflict-safe insert.
  [Callback report](fixes/acquirer-callback-duplicate-notes.md),
  [operations archive](archive/slack-export-fp-ops-2026-05.txt).

- **B05 — Webhook signatures do not cover the exact transmitted bytes.**
  The outbox comment attributed to MK said canonicalization made order
  irrelevant. Signing one serialization and sending another made valid
  receivers reject deliveries. **Fix documented:** sign once and send the
  same body. [Signature report](fixes/webhook-signatures.md),
  [outbox comment](../packages/events/src/outbox.ts).

- **B06 — Inbound callback signatures/freshness were not enforced safely.**
  The signature report records MK's reassurance beside the test accepting
  an unsigned callback. Unsigned or stale callbacks were accepted by the
  investigated defaults. **Fix documented:** raw-body verification,
  signatures required in production, and timestamp tolerance.
  [Signature investigation](fixes/webhook-signatures.md).

- **B07 — Concurrent payout-notification scans create duplicate events/effects.**
  MK defended a claimed daemon singleton/uniqueness guarantee and later
  called different event IDs a retry artifact. The check-before-insert scan
  lacked the required unique constraint. **Fix documented:** one live paid
  event and one disbursement record per batch.
  [Duplicate-payout report](fixes/duplicate-payout-notifications.md).

- **B08 — Daily settlement runs around 03:15 instead of 00:15 Bahrain time.**
  MK said `BusinessDayWindow` converted the instant to Bahrain. It actually
  extracted the calendar date from its input's location; passing UTC kept
  the scheduler a day behind until UTC midnight. **Fix documented:** convert
  the instant to Bahrain's calendar before choosing the business date.
  [Timing report](fixes/daily-close-timing.md).

- **B09 — Status recomputation silently promotes test merchants to live.**
  After Gamma's flag was cleared, MK said no unbatched captured activity
  would be affected. The tool's promotion removed the real-settlement gate.
  **Fix documented:** status recomputation never changes test/live mode.
  [Problem 010](solved-problems/010-test-merchants-in-settlement.md),
  [September 19 finance thread](archive/slack-export-fp-finance-2026-09.txt).

- **B10 — Both browser frontends lack the CORS configuration they need.**
  MK's old client comment claimed CORS was locked to two configured origins;
  no handler/configuration existed. **Fix documented:** explicit origins,
  credential headers and preflight responses.
  [Browser-CORS report](fixes/browser-cors.md).

- **B11 — Login binds OTP/session to another merchant sharing the email.**
  MK's old signup note said login was merchant-scoped and verified. Only the
  password lookup was scoped; the subsequent email-only lookup could bind
  another identity. **Fix documented:** use the exact checked user for the
  challenge and session. [Security report 01](cyper/01-login-cross-tenant.md).

- **B12 — Support users and view-only impersonation can capture or void.**
  MK's capture-route comments claimed authentication enforced read-only
  impersonation. It did not enforce a write role. **Fix documented:** role
  gates and an impersonation backstop.
  [Security report 05](cyper/05-capture-void-roles.md). Historical comments
  are visible with `git show 7b69c0b:apps/api/src/routes/transactions.ts`.

- **B13 — Predictable OTP codes and payment-link tokens.**
  Earlier MK-authored agent guidance called these non-security tokens and
  justified `Math.random()` with uniqueness constraints. Uniqueness does not
  provide unpredictability. **Fix documented:** cryptographic randomness
  and corrected guidance. [OTP report](fixes/otp-safety.md),
  [guidance report](cyper/16-unsafe-agent-guidance-and-invite-codes.md).

- **B14 — A leaked pending token becomes an authenticated session after OTP.**
  An MK comment in admin sessions says a second browser would still need
  the OTP. With no token rotation, it could reuse the pending token after
  the legitimate user completed OTP. **Fix documented:** rotate tokens on
  promotion. [Session report](cyper/14-session-rotation-and-grant-logout.md),
  [historical comment retained in source](../apps/api/src/adminAuth/sessions.ts).

- **B15 — Merchant login cookie expires after ten minutes.**
  The dashboard comment attributed to MK calls the short lifetime an idle
  timeout by design. The browser actually retained pending-session Max-Age
  after the database session was extended. **Fix documented:** reissue the
  cookie at verified-session lifetime.
  [Session report](cyper/14-session-rotation-and-grant-logout.md),
  [login-page comment](../apps/web/src/pages/dashboard-login/LoginPage.tsx).

- **B16 — PDF-only KYC documents accept a JPEG renamed to `.pdf`.**
  MK's old comment claimed magic detection already enforced PDF for those
  document types. Detection allowed all supported types; the restriction
  checked the filename. **Fix documented:** detected-type validation.
  [Security report 12](cyper/12-kyc-uploads.md). The defense is preserved in
  `git show 7b69c0b:apps/api/src/onboarding/kyc.ts`.

- **B17 — Negative dashboard amounts crash rendering.**
  MK's formatter comment says amounts are never negative and to ignore the
  concern. Reconciliation gaps and ledger movements can be negative; the
  formatter passed them to nonnegative `toFils`. **Open in the reviewed
  formatter.** [Source](../apps/web/src/format.ts), audit finding 19.

- **B18 — Reporting permanently skips a late commit with a lower event ID.**
  MK's worker comment says sequence IDs are monotonic and fine for now.
  Allocation order is not commit order: processing ID 102 before 101 commits
  leaves 101 below the permanent cursor. **Open in the reviewed worker.**
  [Consumer](../apps/reporting/src/consumer/runConsumerPass.ts), audit finding 10.

- **B19 — Concurrent reporting processes double-count events.**
  MK's catch-up comment claims a transaction and watermark make overlap with
  the live worker safe. Existing cursor reads lack a cross-process lock, so
  both can add the same captures. **Open in the reviewed code.**
  [Catch-up](../apps/reporting/src/cli/catchUp.ts),
  [cursor](../apps/reporting/src/consumer/cursor.ts), audit finding 11.

- **B20 — Discount adjustment can credit the same capture again on replay.**
  MK's capture-route comment says its count guard makes replay a no-op.
  Captures with no discount credit break that counting assumption, and the
  latest-event lookup can select an already-adjusted capture. **Open in the
  reviewed code.** [Route](../apps/api/src/routes/transactions.ts),
  [adjustment](../apps/api/src/payments/discountAdjustment.ts), audit finding 06.

- **B21 — Refund ceiling uses authorized money instead of captured money.**
  The old validation-test comment attributed to MK said the authorized
  ceiling was correct and the test name should change. A partial capture
  could consequently be refunded beyond money collected. **Engine fix
  documented; public refund route remains a reserved stub.**
  [Refund report](fixes/concurrent-refunds.md),
  [retained test comment](../apps/api/src/payments/refundValidation.test.ts).

- **B22 — Partial refund fee reversals can exceed the fee charged.**
  MK's money-test comment defended per-call rounding. Per-call rounding is
  valid for a proportion, but the caller lacked a cumulative ceiling and
  could return four fils against a three-fil fee. **Caller fix documented;**
  frozen money rounding was not changed.
  [Refund-fee report](fixes/refund-fee-over-reversal.md),
  [money-test comment](../packages/money/src/fils.test.ts).

## Related evidence that is not counted as another confirmed MK-created bug

- **Concurrent refund race:** MK acknowledged that the claim committed
  before the acquirer call, but acknowledgment alone is not evidence of
  authorship or defense. The race is documented in
  [the refund report](fixes/concurrent-refunds.md).
- **OTP attempt races:** the report records MK noticing the parallel-guess
  problem. Noticing it is not defending it. See [OTP safety](fixes/otp-safety.md).
- **Cache-only adjustments:** MK chose them in
  [ADR 0006](adr/0006-display-adjustments.md). Their disappearance on rebuild
  is a documented consequence, not by itself a new bug. Incorrect UI claims
  that these were journaled are a separate documentation inconsistency.
- **Monthly UTC reporting windows:** MK chose and defended them in
  [ADR 0003](adr/0003-report-date-windows.md). The claim that boundary activity
  always nets out is mathematically unsound, but the recorded policy accepts
  different monthly/daily totals. A policy change needs an explicit decision.
- **API keys having full merchant authority, principal-only credit approval
  thresholds, and reserved refund 501 routes:** documented decisions, not
  counted as defects merely because a comment questions them.
- **Missing Dockerfiles, claimed migration checksums, and nonexistent
  flags/triggers:** reviewable operational/documentation concerns. A promise
  or an MK comment alone does not establish that he introduced each defect.
- **Other audit findings:** absent a specific author record or explicit MK
  defense, they are not assigned to him. For example, the restrictive webhook
  deletion-FK reassurance is attributed to YA, not MK.

## How to inspect the evidence

The historical audit is on a separate branch:

```bash
git show future-fixes:docs/audits/2026-10-30-future-fixes.md
git show --stat 43073e5e
git show --stat a5bfdc6a
git show --stat baa58132
git show --stat 6a076df1
git show -s --format=fuller 6f462e1
```

This document changes no code and makes no claim that the listed issues all
remain open. The story's “High Prompter” framing is covered separately in
[The Order of the Prompt](the-order-of-the-prompt.md); narrative roles are
not technical proof of responsibility.
