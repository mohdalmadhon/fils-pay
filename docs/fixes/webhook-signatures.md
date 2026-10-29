# Fix report: webhook signatures rejected by merchants

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | High. Merchants could not verify any webhook we sent, so a receiver doing it properly rejected every delivery (Beta Digital: `401 invalid signature`, deliveries exhausted). On the inbound side, anyone could post a fake acquirer verdict. |
| **Components** | Outbound: `apps/api/src/webhooks/sign.ts`, `dispatcher.ts`, `testSend.ts`. Inbound: `apps/api/src/webhooks/inboundVerify.ts`, `routes/acquirerCallbacks.ts`, `config.ts` |
| **Reported** | Some merchants can't verify our webhook signatures; the signer and the sender don't agree on what the message looks like. The incoming signature check also has its own problems. |
| **Date** | 2026-10-29 |

## Summary

**Outbound.** We signed one string and sent a different one.
`signPayload` signed `canonicalJson(payload)`, with keys sorted
alphabetically. The dispatcher and the "send test event" tool then sent
`JSON.stringify(payload)`. The payload comes back from Postgres `jsonb`,
which orders keys its own way (shortest key first), so the bytes on the wire
were never the bytes that were signed. Every receiver that verifies the raw
body, which is what every webhook guide says to do, failed on every
delivery.

**Inbound.** The acquirer-callback check had four separate holes:

1. Signatures were optional by default
   (`ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=false`), even in production. A
   request with no header was accepted.
2. It verified a re-serialized copy of the parsed body, not the bytes
   received, so genuine callbacks with different whitespace or key order
   failed.
3. It never checked the timestamp, so a captured callback could be replayed
   forever.
4. With no secret configured it happily verified HMACs keyed with `""`,
   which anyone can compute. Its "constant-time" compare was a
   length check plus `Buffer.compare`.

## Where it was found

**Outbound**

- `apps/api/src/webhooks/sign.ts`, `signPayload`: signed
  `` `${timestamp}.${canonicalJson(payload)}` ``.
- `apps/api/src/webhooks/dispatcher.ts`, `attemptOneDelivery`: sent
  `body: JSON.stringify(row.payload)`, where `row.payload` was read back from
  `webhook_deliveries.payload` (`jsonb`).
- `apps/api/src/webhooks/testSend.ts`: same split. A comment claimed
  "test-send signs exactly the bytes it sends", which was false
  (insertion-order `JSON.stringify` vs sorted keys).
- Why the tests never caught it: `dispatcher.test.ts` and
  `testSend.test.ts` `JSON.parse` the body and verify the re-sorted object,
  a step no real receiver takes. YA's comment on that test says exactly this.
- The docs worked around it instead of fixing it. `docs/RUNBOOK.md` told
  support to ask merchants to "parse the body and re-serialise it with sorted
  keys". `packages/events/src/outbox.ts` (YA): "anything that signs the
  payload has to sign what it SENDS". The unmerged branch `ya/sign-raw`
  ("sign the exact bytes we send") was deleted when Yousif left. The
  evidence is `docs/exports/webhook-deliveries-beta-2026-09.csv`: every Beta
  delivery shows `401 {"error":"invalid signature"}`.

**Inbound**

- `apps/api/src/config.ts`:
  `acquirerCallbackRequireSignature: parseBoolEnv(..., false)`, with no
  production override.
- `apps/api/src/webhooks/inboundVerify.ts`: `if (!header) return { valid: true }`
  when not required. It hashed `JSON.stringify(payload)`, the parsed and
  re-stringified body. It had no timestamp check ("freshness is not checked
  for inbound callbacks"), no empty-secret guard, and `constantTimeEquals`
  was not constant-time.
- `apps/api/src/routes/acquirerCallbacks.ts`: passed the parsed `body` to
  the verifier, since the raw body was never kept.
- Existing tests locked this in: "an unsigned callback is accepted while
  signature checking is optional" and "POST /v1/acquirer/callbacks accepts a
  callback sent without a signature header". Next to the latter, MK commented
  "prod rejects"; it didn't.

## Reproduction

New `apps/api/src/webhooks/signatureRawBody.test.ts`. A merchant-style
verifier computes its own HMAC over the raw body received. **Before** the
fix, all 4 delivery paths failed: normal `transaction.captured`,
`settlement.paid`, a retried delivery, a replayed delivery, and "send test
event". The body sent was
`{"id":…,"data":{"status":…,"feeFils":…},"type":…,"createdAt":…}` while
the signature covered `{"createdAt":…,"data":{…},"id":…,"type":…}`.

New `apps/api/src/routes/acquirerCallbacksSignature.test.ts`, run against
the **old** inbound code: 7 of 8 failed.

| Test | Expected | Before fix |
|---|---|---|
| No signature header | 401, nothing saved | **200, note saved** |
| Genuine callback, pretty-printed / different key order | 200 | **401** (re-serialized copy didn't match) |
| Correctly signed, timestamp 1 h old (replay) | 401 | **200** |
| Timestamp 1 h in the future | 401 | **200** |
| No secret configured, HMAC keyed with `""` | 401 | **200** |
| Invalid JSON | 400 | crash/500 path |
| `REQUIRE_SIGNATURE=false` in production | ignored, still required | **honoured** |
| Body changed after signing | 401 | 401 (already worked) |

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `webhooks: sign the exact body bytes that are sent` | `signPayload` serializes once and returns the signed string as `body`. The dispatcher and test-send send that `body` verbatim. New `verifyRawBody(rawBody, header, secret)` checks a signature the way a receiver should. `verifySignature(payload, …)` stays for callers holding a parsed object. |
| 2 | `test: verify outgoing webhook signatures over the raw body` | `signatureRawBody.test.ts`: 5 tests with an independent, merchant-style HMAC check over the raw bytes, covering normal, `settlement.paid`, retry, replay and test-send. |
| 3 | `acquirer callbacks: verify the signature over the raw request body` | The callback route keeps the raw body, using a JSON parser scoped to that route only. The verifier hashes those bytes. The header must be exactly 64 hex characters and is compared with `crypto.timingSafeEqual`. An empty secret is always rejected (`signing_secret_not_configured`). Invalid JSON returns 400. |
| 4 | `acquirer callbacks: require a signature and reject stale timestamps` | `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` now defaults to `true` and is forced on in production. New `ACQUIRER_CALLBACK_SIGNATURE_TOLERANCE_SECONDS` (default 300) rejects old or future timestamps, checked after the HMAC. New `acquirerCallbacksSignature.test.ts` (8 tests). |
| 5 | `docs: webhook signature fix report and runbook` | This report. `RUNBOOK.md` now tells merchants to verify over the raw body. `ARCHITECTURE.md` updated for the new defaults. |

**Existing tests changed in commit 4, and why:**

- Two tests asserted that **unsigned callbacks are accepted**. That is the
  vulnerability, so they now assert the opposite. The verifier test also
  checks that an explicit opt-out (`requireSignature = false`) still works.
- Three test helpers signed with a fixed timestamp from September 2025, which
  the new 5-minute window correctly rejects. They now sign with the current
  time. Nothing they assert changed.

## Verification

- `signatureRawBody.test.ts`: 5/5 pass (all 4 delivery paths failed before).
- `acquirerCallbacksSignature.test.ts`: 8/8 pass (7 failed against the old code).
- Existing webhook tests (`sign`, `dispatcher`, `testSend`, `envelope`,
  `archiveReplay`, `routes/webhooks`, `payoutDisbursement`) and callback
  tests (`acquirerCallbacks`, `acquirerCallbacksDedupe`, `callbacks`,
  `inboundVerify`, `app`) all pass.
- `tsc --noEmit` is clean.
- Full `apps/api` suite: **387/388**. The one failure is the dispatcher
  backoff/exhaustion test, which was already failing before this work.

## Deploying

- **Before deploying, make sure the acquirer signs every callback** and that
  `ACQUIRER_CALLBACK_SIGNING_SECRET` is set. Unsigned callbacks are now
  refused with `401`. The acquirer retries on non-2xx, so nothing is lost if
  the secret is set before signing is switched on.
- The callback endpoint now requires the acquirer's clock to be within 5
  minutes of ours. Raise `ACQUIRER_CALLBACK_SIGNATURE_TOLERANCE_SECONDS` if
  their clock drifts.
- **Merchants:** nothing to change. Receivers that verify the raw body (the
  correct way) start working straight away. Any merchant who added the old
  "parse and re-sort the keys" workaround keeps working too, because the body
  is now sent already key-sorted. They can drop the workaround.
- Re-send failed and exhausted deliveries for affected endpoints (e.g. Beta)
  with the admin batch replay so merchants get the events they missed.

## Related, not changed here

- A replay gets a new `Webhook-Delivery-Id` (`replay.ts`). The docs say it
  should stay the same, so receivers deduping on that header process a
  replay twice.
- `settlement.paid` records a payout disbursement as a side effect of the
  first delivery attempt, once per endpoint and again on every replay
  (`PRE_DELIVERY_EFFECTS` in `dispatcher.ts`). That caused the duplicate
  disbursements in the 2026-08-21 incident.
- Outbound webhooks have no SSRF protection: private and internal hosts are
  allowed, and fetch follows redirects.
