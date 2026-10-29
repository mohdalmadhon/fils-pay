/**
 * Regression tests for incident 2026-05-14: "payment link charged twice".
 *
 * A pay attempt reserves the link for a short timeout. When the first buyer's
 * acquirer call was slow, the reservation timed out, a second buyer took the
 * link over, and both captures went through. The first attempt then failed to
 * finalize and still answered 200. These tests drive payPaymentLink with an
 * acquirer whose timing is scripted per card, and a 1-second reservation
 * timeout, and count how many captures actually reach the acquirer.
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { recordKycReview } from "../onboarding/review.js";
import type {
  AcquirerAuthorizeResult,
  AcquirerCaptureResult,
  AcquirerRefundResult,
  AcquirerSimulator,
  SimulatedCardInput,
} from "../acquirer/types.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payConcurrency.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const RESERVATION = { paymentLinkReservationTimeoutSeconds: 1 };

test.after(async () => {
  await pool.end();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CardScript {
  authorizeMs?: number;
  captureMs?: number;
  declineAuthorize?: boolean;
}

/** An acquirer whose behaviour is scripted by card number, and which counts
 *  every capture that reaches it (i.e. every time a buyer is charged). */
function scriptedAcquirer(scripts: Record<string, CardScript>) {
  const captureByReference = new Map<string, number>();
  const charged: string[] = [];
  const acquirer: AcquirerSimulator = {
    async authorize(req): Promise<AcquirerAuthorizeResult> {
      const script = scripts[req.card.pan] ?? {};
      await sleep(script.authorizeMs ?? 0);
      const acquirerReference = `acq_${randomUUID()}`;
      captureByReference.set(acquirerReference, script.captureMs ?? 0);
      if (script.declineAuthorize) {
        return { outcome: "declined", declineReason: "do_not_honor", acquirerReference, latencyMs: 0 };
      }
      return { outcome: "approved", acquirerReference, latencyMs: 0 };
    },
    async capture(req): Promise<AcquirerCaptureResult> {
      await sleep(captureByReference.get(req.acquirerReference) ?? 0);
      charged.push(req.acquirerReference);
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
    async refund(req): Promise<AcquirerRefundResult> {
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
  };
  return { acquirer, charged };
}

function card(pan: string): SimulatedCardInput {
  return { pan, expiryMonth: 12, expiryYear: 2030, cvv: "123" };
}

async function createLink(): Promise<{ merchantId: string; token: string; linkId: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Pay Concurrency ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const token = `plink_${randomUUID()}`;
  const link = await pool.query<{ id: string }>(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, 4750, now() + interval '1 hour', 'merchant_api_key', $3) RETURNING id`,
    [merchantId, token, randomUUID()],
  );
  return { merchantId, token, linkId: link.rows[0]!.id };
}

function pay(acquirer: AcquirerSimulator, token: string, pan: string) {
  return payPaymentLink(pool, acquirer, RESERVATION, { token, card: card(pan), idempotencyKey: randomUUID() });
}

async function capturedTransactions(merchantId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  return result.rows[0]!.n;
}

test("incident replay: slow capture outlives the reservation, second buyer is refused, one charge", async () => {
  const { merchantId, token, linkId } = await createLink();
  const { acquirer, charged } = scriptedAcquirer({
    "4000000000000001": { captureMs: 2_500 }, // buyer A: capture slower than the 1 s reservation
    "4000000000000002": {}, // buyer B: fast
  });

  const first = pay(acquirer, token, "4000000000000001");
  await sleep(1_300); // A's reservation has timed out; A's capture is still in flight
  const startedB = Date.now();
  const second = await pay(acquirer, token, "4000000000000002");
  const bWaitedMs = Date.now() - startedB;

  assert.equal(second.statusCode, 409, JSON.stringify(second.body));
  assert.ok(bWaitedMs < 1_000, `the second buyer must be refused straight away, waited ${bWaitedMs} ms`);

  const firstResult = await first;
  assert.equal(firstResult.statusCode, 200, JSON.stringify(firstResult.body));

  assert.equal(charged.length, 1, "exactly one buyer may be charged");
  assert.equal(await capturedTransactions(merchantId), 1);
  const link = await pool.query<{ status: string; transaction_id: string }>(
    `SELECT status, transaction_id FROM payment_links WHERE id = $1`,
    [linkId],
  );
  assert.equal(link.rows[0]!.status, "paid");
  assert.equal(link.rows[0]!.transaction_id, (firstResult.body as { transactionId: string }).transactionId);
});

test("slow authorize: a later buyer takes over, the first attempt never captures and is voided", async () => {
  const { merchantId, token } = await createLink();
  const { acquirer, charged } = scriptedAcquirer({
    "4000000000000011": { authorizeMs: 2_500 }, // buyer A: stuck at authorize past the timeout
    "4000000000000012": {}, // buyer B
  });

  const first = pay(acquirer, token, "4000000000000011");
  await sleep(1_300);
  const second = await pay(acquirer, token, "4000000000000012");
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));

  const firstResult = await first;
  assert.equal(firstResult.statusCode, 409, JSON.stringify(firstResult.body));
  assert.equal(charged.length, 1);
  assert.equal(await capturedTransactions(merchantId), 1);

  const voided = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM transactions WHERE merchant_id = $1 AND status = 'voided'`,
    [merchantId],
  );
  assert.equal(voided.rows[0]!.n, 1, "the losing attempt's authorization is voided, not left open");
});

test("a declined attempt cannot release another buyer's reservation", async () => {
  const { merchantId, token } = await createLink();
  const { acquirer, charged } = scriptedAcquirer({
    "4000000000000021": { authorizeMs: 2_000, declineAuthorize: true }, // A: slow, then declined
    "4000000000000022": { captureMs: 3_000 }, // B: takes over, slow capture
    "4000000000000023": {}, // C: arrives while B is still capturing
  });

  const a = pay(acquirer, token, "4000000000000021");
  await sleep(1_300);
  const b = pay(acquirer, token, "4000000000000022"); // reserves after A's timeout
  await sleep(1_200); // A is declined and releases (t≈2.0 s); B is still capturing
  const c = await pay(acquirer, token, "4000000000000023");

  assert.equal(c.statusCode, 409, `C must not get in while B is paying: ${JSON.stringify(c.body)}`);
  assert.equal((await a).statusCode, 402);
  assert.equal((await b).statusCode, 200);
  assert.equal(charged.length, 1);
  assert.equal(await capturedTransactions(merchantId), 1);
});

test("two buyers at the same instant: one is charged, the other is told it is processing", async () => {
  const { merchantId, token } = await createLink();
  const { acquirer, charged } = scriptedAcquirer({
    "4000000000000031": { captureMs: 300 },
    "4000000000000032": { captureMs: 300 },
  });

  const results = await Promise.all([pay(acquirer, token, "4000000000000031"), pay(acquirer, token, "4000000000000032")]);
  const codes = results.map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(charged.length, 1);
  assert.equal(await capturedTransactions(merchantId), 1);
});
