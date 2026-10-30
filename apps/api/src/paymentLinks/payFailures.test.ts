/**
 * What a failed checkout attempt leaves behind (docs/bugs/003, 004).
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payFailures.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const RESERVATION = { paymentLinkReservationTimeoutSeconds: 60 };

test.after(async () => {
  await pool.end();
});

const CARD: SimulatedCardInput = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function acquirer(opts: { authorizeThrows?: boolean; declineCapture?: boolean } = {}): AcquirerSimulator {
  return {
    async authorize() {
      if (opts.authorizeThrows) throw new Error("acquirer connection reset");
      return { outcome: "approved", acquirerReference: `acq_${randomUUID()}`, latencyMs: 0 };
    },
    async capture(req) {
      if (opts.declineCapture) {
        return { outcome: "declined", declineReason: "do_not_honor", acquirerReference: req.acquirerReference, latencyMs: 0 };
      }
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
    async refund(req) {
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
  } as AcquirerSimulator;
}

async function createLink(): Promise<{ merchantId: string; token: string; linkId: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Pay Failures ${randomUUID()}`],
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

async function linkStatus(linkId: string): Promise<string> {
  const r = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [linkId]);
  return r.rows[0]!.status;
}

test("an attempt that throws hands the link back instead of leaving it reserved", async () => {
  const { token, linkId } = await createLink();
  await assert.rejects(
    payPaymentLink(pool, acquirer({ authorizeThrows: true }), RESERVATION, { token, card: CARD, idempotencyKey: randomUUID() }),
  );
  assert.equal(await linkStatus(linkId), "active");

  // The next buyer can pay straight away.
  const next = await payPaymentLink(pool, acquirer(), RESERVATION, { token, card: CARD, idempotencyKey: randomUUID() });
  assert.equal(next.statusCode, 200, JSON.stringify(next.body));
});
