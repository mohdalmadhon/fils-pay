# FilsPay read-only audit

Reviewed 2026-10-30, Asia/Bahrain. Snapshot: main `7b69c0b`.
Repository files and persistent database state were not changed.

The review covered the API, settlement worker, reporting worker, merchant
and admin clients, shared helpers, scripts, migrations and operational
setup. All 14 commits attributed to Mahmood Khalil were prioritized. This
is a repository-wide source review with selected isolated probes, not a
claim that every runtime interleaving or production deployment was tested.
Git attribution identifies relevant code history, not personal responsibility
for every interacting path. Initials in comments were not treated as authorship.

P1 means prioritize for financial correctness, tenant isolation or destructive
behavior. P2 means a follow-up correctness/availability defect. Evidence below
distinguishes actual helper execution from source/interleaving analysis.

## 01. [P1] Empty expired-hold cleanup deletes every hold

Source: [sqlFilter.ts:10](../../scripts/lib/sqlFilter.ts#L10), [expire_holds.ts:24](../../scripts/expire_holds.ts#L24).
History: Fatima Haji, `a2fd53db`.

An empty ID array is omitted from the predicate, producing `DELETE FROM holds`
with no WHERE clause. A normal night with zero expired holds can therefore
remove active/released holds too. Nonempty deletes also fail to recheck the
status/expiry after selection, so concurrent state changes are not protected.
Evidence: actual `buildExpiredHoldsDelete([])` returned that exact unqualified
DELETE. It was never executed.

## 02. [P1] Transaction reports disclose another merchant's transactions

Source: [scope.ts:13](../../apps/api/src/reporting/scope.ts#L13), [reporting route](../../apps/api/src/routes/reporting.ts#L37).
History: Yousif Al-Ansari, `901312a7`.

A filter can request any marketplace child. The helper checks only that the
requested ID is a child somewhere, not that its parent is the caller. The
report then queries the requested merchant. Evidence: the actual helper with
an isolated query double accepted child B for unrelated caller A; its SQL
contained no caller/parent parameter. No real merchant data was read.

## 03. [P1] Login can bind the session to the wrong merchant

Source: [auth.ts:78](../../apps/api/src/routes/auth.ts#L78), [users.ts:11](../../apps/api/src/auth/users.ts#L11).
History: Fatima Haji, `a9b27531`.

Password checking is correctly scoped to merchant+email, but the next
email-only lookup selects the OTP/session identity across active merchants.
A shared email can authenticate with B's password and obtain a pending session
for A and A's role. OTP is still required; this is wrong-tenant binding,
not an OTP bypass. The seed deliberately contains a shared email in two
merchants. Evidence: active route/helper source; no real login attempted.

## 04. [P1] Actual payout calculation loses fils through float32

Source: [payable.go:10](../../apps/settlement/internal/settlement/payable.go#L10), [batch.go:219](../../apps/settlement/internal/settlement/batch.go#L219).
History: **MK / Mahmood Khalil, `baa58132`**.

`NetPayableFils` converts integer gross and fees to float32 BD, subtracts,
and rounds back to fils. This determines the actual batch payout, separately
from the fixed lifetime monitoring counter. Gross 100,000,001 minus fees
2,500,000 should yield 97,500,001; it yields 97,500,000. Evidence: reproduced
that exact binary32 arithmetic sequence; no payout was run.

## 05. [P1] Platform volume wraps negative and changes pricing

Source: [platform_volume.go:26](../../apps/settlement/internal/settlement/platform_volume.go#L26), [migration 0049](../../db/migrations/0049_platform_stats.sql#L7).
History: **MK / Mahmood Khalil, `a5bfdc6a`** (Go accumulator).

The counter and Go addition use int32, including narrowing each batch's gross.
2,147,483,640 + 100 wraps to -2,147,483,556 before being stored. The tier test
then becomes false and removes a 15-bps discount. PostgreSQL accepts the
already-wrapped negative value. Evidence: reproduced signed-int32 arithmetic
and traced it into both pricing readers; no counter changed.

## 06. [P1] Capture discount can be credited twice on replay

Source: [discountAdjustment.ts:60](../../apps/api/src/payments/discountAdjustment.ts#L60).
History: Yousif Al-Ansari, `69189e26` (guard/event selection).

Deduplication counts capture events versus discount ledger credits instead
of identifying the adjusted event. A capture with zero discount creates no
credit. With two captures, one zero-discount and one already adjusted, a
replay still sees 1 < 2 and credits the latest capture again. Latest-event
selection also misattributes interleaved partial-capture adjustments.
Evidence: actual function with an isolated query double emitted another
10-fil adjustment for this state. No persistent INSERT was executed.

## 07. [P1] Rebuild followed by close double-counts an unbatched capture

Source: [capture.ts:227](../../apps/api/src/payments/capture.ts#L227), [rebuild.go:49](../../apps/settlement/internal/ledger/rebuild.go#L49), [cache.go:25](../../apps/settlement/internal/balances/cache.go#L25).
History: interacting lifecycle; original cache increment Yousif, `28392ef9`.

Capture already credits the payable ledger. Rebuild includes that unbatched
credit in cache. Later closing adds the same net to cache again, without
posting a corresponding new ledger credit. Example: 9,750 after rebuild;
19,500 after close; 9,750 after payout, while ledger payable is zero.
The cache lock prevents concurrent lost updates, not this lifecycle mismatch.
Evidence: source/call-chain arithmetic; no financial sequence was executed.

## 08. [P1] Webhook URLs can reach private-network services

Source: [create.ts:15](../../apps/api/src/webhooks/create.ts#L15), [transport.ts:39](../../apps/api/src/webhooks/transport.ts#L39), [testSend.ts:59](../../apps/api/src/webhooks/testSend.ts#L59).
History: Yousif Al-Ansari, `c2f36276` (validator).

Production requires HTTPS but does not reject private IPs, localhost or
private DNS results. Fetch follows redirects without target revalidation;
test-send exposes a response excerpt. Actual reachability depends on TLS
and network policy. Evidence: actual production validator accepted
`https://127.0.0.1:8091/private`. No request to it was made.

## 09. [P1] Capture and settlement discount different rounded values

Source: [discounted_fee.go:7](../../apps/settlement/internal/settlement/discounted_fee.go#L7), [discountAdjustment.ts:80](../../apps/api/src/payments/discountAdjustment.ts#L80).
History: **MK / Mahmood Khalil, `baa58132`** (settlement formula).

Capture discounts the rounded MDR fee; settlement discounts the captured
amount and then calculates MDR. Rounding makes them differ. At 21 fils,
250-bps MDR and 1,250-bps discount, capture ultimately charges 1 fil but
settlement records zero. Evidence: reproduced both formulas using the actual
validated rate helper. No money was posted.

## 10. [P2] Reporting can permanently skip late-committing events

Source: [runConsumerPass.ts:46](../../apps/reporting/src/consumer/runConsumerPass.ts#L46).
History: Yousif Al-Ansari, `3f18d11e`.

Sequence IDs are treated as commit order. A allocates 101; B allocates and
commits 102; worker processes 102; A commits 101. Event 101 is now below the
watermark and never selected. Evidence: source/interleaving analysis. This
unfinished concern is also mentioned in HANDOVER.

## 11. [P2] Concurrent reporting processes double-count events

Source: [cursor.ts:32](../../apps/reporting/src/consumer/cursor.ts#L32).
History: Yousif Al-Ansari, `3f18d11e`.

The existing watermark is read without FOR UPDATE or an equivalent
cross-process lock. Two passes can read it, add the same captures, then both
advance it. A process-local running flag does not protect another worker or
catch-up process. Evidence: source and additive-rollup SQL analysis, not a
production race execution.

## 12. [P2] Admin analytics rebuild double-counts an unconsumed backlog

Source: [reportingRebuild.ts:11](../../apps/api/src/admin/reportingRebuild.ts#L11).
History: Yousif Al-Ansari, `141d8c87`.

The admin rebuild fills rollups from all transaction events but leaves the
reporting cursor unchanged. Backlogged captures included in the rebuild are
then applied again by the worker. Pausing the worker during rebuild does not
prevent that later duplication. Evidence: active route/rebuild/cursor paths.

## 13. [P2] Default dashboard browser login fails preflight

Source: [client.ts:3](../../apps/web/src/api/client.ts#L3), [app.ts:41](../../apps/api/src/app.ts#L41).
History: frontend/API configuration spans authors; no MK attribution inferred.

Dashboards default to 5173/5174 and API to 3000, using credentialed JSON
requests. There is no configured CORS handler or Vite proxy. Actual injected
OPTIONS /v1/auth/login from origin localhost:5173 returned 404 without
Allow-Origin or Allow-Credentials. A separate deployment proxy can mask this;
the checked-in default setup cannot. No database query was made.

## 14. [P2] Merchant cookie expires after ten minutes

Source: [auth.ts:104](../../apps/api/src/routes/auth.ts#L104), [auth.ts:157](../../apps/api/src/routes/auth.ts#L157).
History: Fatima Haji, `a9b27531`.

Login sets cookie Max-Age to pending TTL (default ten minutes). OTP success
extends only database expiry to twelve hours and does not reissue the cookie.
The browser still drops it at the original deadline. Evidence: active cookie
and verification code; no real session changed.

## 15. [P2] Manual credits reverse the wrong fee rate

Source: [credits.ts:213](../../apps/api/src/admin/credits.ts#L213).
History: **MK / Mahmood Khalil, `43073e5e`**.

Fee reversal uses merchants.mdr_bps, ignoring the effective schedule,
negotiated discount and volume tier used in capture. With fallback 245 but
effective 225 bps, a 10,000-fil credit reverses 245 instead of 225 fils.
Evidence: active reversal inputs versus capture resolver; no real credit audited.

## 16. [P2] Future-dated credits affect today's balance

Source: [creditRequestValidation.ts:76](../../apps/api/src/admin/creditRequestValidation.ts#L76).
History: **MK / Mahmood Khalil, `43073e5e`**.

The validator promises today-or-earlier but only checks calendar syntax.
A 2099 date is accepted. Posting uses future ledger occurrence while changing
the cache immediately. Evidence: actual parser accepted `2099-01-01`;
no credit posted. Posting/cache behavior is source-derived.

## 17. [P2] Go fee-schedule ties disagree with API ordering

Source: [fee_schedule.go:32](../../apps/settlement/internal/settlement/fee_schedule.go#L32), [feeSchedule.ts:33](../../apps/api/src/fees/feeSchedule.ts#L33).
History: Yousif Al-Ansari, `cf945410` (Go).

API uses effective_from DESC, created_at DESC. Go orders only by
effective_from ASC and selects the last match. Same-effective-date corrections
can therefore resolve differently. The schema permits them. Evidence: query
and traversal comparison; deployed rows were not changed.

## 18. [P2] PDF-only KYC types accept renamed images

Source: [kyc.ts:67](../../apps/api/src/onboarding/kyc.ts#L67).
History: Ali Marzooq, `717dd8be`.

General magic detection accepts PDF/JPEG/PNG, but commercial-registration and
bank-letter restrictions only test the filename. A JPEG named bank_letter.pdf
passes that branch and is stored as JPEG. Evidence: source validation flow;
no upload or disk write was made.

## 19. [P2] Negative reconciliation values crash rendering

Source: [format.ts:11](../../apps/web/src/format.ts#L11), [ReconciliationPage.tsx:115](../../apps/web/src/pages/settlement/ReconciliationPage.tsx#L115).
History: Fatima Haji, `02450241`.

The formatter rejects negative fils, while gaps/payable positions may be
negative and are rendered through it. Evidence: actual `bhd(-1)` threw the
nonnegative-fils validation error.

## 20. [P2] Expired stale reservations are shown as active

Source: [status.ts:39](../../apps/api/src/paymentLinks/status.ts#L39).
History: **MK / Mahmood Khalil, `6a076df1`**.

Reserved-row public status ignores expiresAt once the reservation times out,
returning active. Payment correctly rejects the same expired link with 410,
so this is a read/checkout-state bug, not an expiry bypass. Evidence: actual
status helper returned active for an expired stale reservation.

## 21. [P2] Used webhook endpoints cannot be deleted

Source: [cancel.ts:22](../../apps/api/src/webhooks/cancel.ts#L22), [0022 migration:6](../../db/migrations/0022_webhook_deliveries.sql#L6).
History: Yousif Al-Ansari, `c2f36276`.

The route hard-deletes endpoints, but delivery rows have a NOT NULL
restrictive foreign key. Archives also reference endpoints restrictively.
No later migration supplies the claimed SET NULL or CASCADE behavior.
An endpoint with history therefore causes a foreign-key error/500.
Evidence: DELETE and all migration references; no endpoint was deleted.

## 22. [P2] Disabling endpoints does not stop queued deliveries

Source: [dispatcher.ts:228](../../apps/api/src/webhooks/dispatcher.ts#L228).
History: Yousif Al-Ansari, `c2f36276`.

Creation filters active endpoints, but pending-delivery selection does not.
A disabled endpoint continues receiving its queued deliveries. Evidence:
actual dispatcher with isolated query/transport doubles sent one queued
message for a disabled endpoint. No network or persistent update occurred.

## 23. [P2] Built-in development encryption key fails validation

Source: [config.ts:162](../../apps/api/src/config.ts#L162).
History: Yousif Al-Ansari, `cece910c`.

The nonproduction fallback decodes to 34 bytes; the validator requires 32.
A fresh default development start without an explicit key therefore fails.
Evidence: actual loadConfig threw the 34-versus-32-byte error with a synthetic
DATABASE_URL. No connection was opened.

## 24. [P2] Bulk KYC approval overwrites states outside the review queue

Source: [bulkKyc.ts:27](../../apps/api/src/admin/bulkKyc.ts#L27).
History: Yousif Al-Ansari, `53b9fcd1`.

The operation promises only under_review rows move, but its UPDATE only
filters IDs. Rejected/unreviewed merchants also become approved, and
already-approved rows are reported as newly approved. It does not insert
per-merchant review rows, although it does write a bulk audit record.
Evidence: active route/UPDATE, documented return contract and admin guide;
no KYC status changed.

## Additional conditional concerns and known blockers

- **MK export capacity risk (`7310bc38`):** the active export route calls
  [buildTransactionsExportCsv:31](../../apps/api/src/transactions/exportCsv.ts#L31),
  loading all matched rows and building CSV in memory. Both date bounds are
  optional. Large full-history exports can exhaust the API's memory. The
  streaming helper is unused and has a timestamp-only cursor that would skip
  tied rows if activated unchanged. No OOM was induced.
- Webhook transport buffers the whole receiver response before keeping a
  2-KB excerpt. A time limit is not a byte limit. No large response fetched.
- Existing keys/sessions and payment writes do not enforce merchant.status.
  If suspension must halt card processing, this bypasses that policy. The
  exact suspension contract needs confirmation before calling it a policy bug.
- Already-known setup blockers remain: 0054 references a nonexistent table;
  0055 uses incompatible chart-of-accounts columns; compose references absent
  Dockerfiles and does not wait for successful migrations before seed/apps.

## Boundaries

24 findings: six in code attributed to MK/Mahmood Khalil (04, 05, 09, 15,
16, 20), plus the separate MK export capacity concern. This is attribution
of relevant code, not evidence that other authors' issues are MK's work.

No production system, real financial operation, private webhook service,
or persistent database state was touched. Full suites were not rerun:
they mutate shared fixtures and this unchanged snapshot already has documented
failures. Probes used pure functions, query doubles, no-database Fastify
injection and arithmetic reproduction. Concurrency/lifecycle cases require
isolated integration tests before a fix is declared complete.

Reserved refund 501 stubs, deliberately deferred refund webhook eligibility,
and ADR-documented cache-only display adjustments were not counted as new bugs.
Previously fixed scheme representation, cancellation ownership, OTP completion
and March sweep duplicate protection remain implemented. Working tree is clean.
