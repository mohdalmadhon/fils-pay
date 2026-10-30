import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { toFils } from "@filspay/money";
import { withTransaction } from "../db/withTransaction.js";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransactionWithClient } from "../payments/capture.js";
import { applyCaptureDiscountAdjustmentWithClient } from "../payments/discountAdjustment.js";
import { voidTransaction } from "../payments/void.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
}

export interface PayPaymentLinkResult {
  statusCode: number;
  body: unknown;
}

/** Returned by the claim UPDATE; merchant_id comes from the link row, never from the request. */
interface ClaimedLinkRow {
  id: string;
  merchant_id: string;
  amount_fils: string | number;
  reference: string | null;
}

interface LinkStatusRow {
  status: string;
  /** Computed by Postgres against its own now(), the same clock the claim UPDATE uses. */
  expired: boolean;
}

/**
 * @deprecated Not used by the pay flow, and it must never be used to decide
 * whether a link has expired. It returns whatever instant the caller
 * supplied, and `submittedAt` arrives in the unauthenticated public pay
 * request body, so a buyer (or anyone with the link) could backdate it to
 * pay an expired link, or postdate it to block a valid payment. Expiry is
 * judged only against the database clock (see the claim UPDATE below).
 * Kept only because the locked test file pay.test.ts still imports it;
 * delete both together.
 */
export function expiryReferenceTime(submittedAt?: string): Date {
  if (!submittedAt) return new Date();
  const parsed = new Date(submittedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * `POST /v1/payment-links/:token/pay` business logic (public,
 * unauthenticated). Calls `authorizeTransaction` and then
 * `captureTransactionWithClient` directly, never issuing an HTTP request back
 * into the API's own /v1/transactions routes.
 *
 * Concurrency (incident 2026-05-14, two buyers charged on one link):
 *
 *  1. Reserve. A single conditional UPDATE marks the link 'reserved' with a
 *     fresh `reservation_token` owned by this attempt. A reservation older
 *     than the timeout may be taken over, so a crashed attempt can't block a
 *     link forever. A row that is locked right now (another attempt is
 *     capturing) is skipped, and the caller is told it is processing.
 *  2. Authorize, with no lock held (the slow, retriable part).
 *  3. Capture and finalize in ONE transaction that first locks the link row
 *     and checks the token is still ours. If another attempt took over while
 *     we were authorizing, we never capture: we void our own authorization
 *     and answer 409. While we hold the lock nobody else can reserve or
 *     finalize, however long the acquirer takes, and the link becomes 'paid'
 *     in the same commit as the capture.
 *
 * Releasing after a decline also checks the token, so a slow attempt can
 * never release a reservation that now belongs to a different buyer.
 */
export async function payPaymentLink(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  const reservationToken = randomUUID();

  // Step 1 — reserve. Expiry is checked against the database's own now() and
  // nothing else; nothing the caller sends (this route is public) can move
  // the instant the link is judged at — see the expiryReferenceTime note.
  const claimResult = await pool.query<ClaimedLinkRow>(
    `WITH candidate AS (
       SELECT id FROM payment_links
        WHERE token = $1
          AND expires_at > now()
          -- a suspended or closed merchant can't take payments
          AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = payment_links.merchant_id AND m.status = 'active')
          AND (
               status = 'active'
               OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval)
              )
        FOR UPDATE SKIP LOCKED
     )
     UPDATE payment_links pl
        SET status = 'reserved', reserved_at = now(), reservation_token = $3
       FROM candidate
      WHERE pl.id = candidate.id
      RETURNING pl.id, pl.merchant_id, pl.amount_fils, pl.reference`,
    [input.token, config.paymentLinkReservationTimeoutSeconds, reservationToken],
  );

  const claimedRow = claimResult.rows[0];
  if (!claimedRow) {
    return classifyClaimFailure(pool, input.token);
  }

  const link = {
    id: claimedRow.id,
    merchantId: claimedRow.merchant_id,
    amountFils: toFils(Number(claimedRow.amount_fils)),
    reference: claimedRow.reference,
  };

  // Step 2 — authorize.
  // am: keys include link.id so two links can never collide on idempotency. good
  const authorizeKey = `paylink:${link.id}:${input.idempotencyKey}:authorize`;
  // Anything that throws from here on (a malformed card, a reused key, an
  // acquirer or database error) must hand the link back first, or it stays
  // 'reserved' until the timeout and blocks every real buyer (and the
  // merchant's cancel) — and anyone could keep it blocked with one bad
  // request a minute. docs/bugs/003.
  const authResult = await authorizeTransaction(pool, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
  }).catch(releaseThenRethrow(pool, link.id, reservationToken));

  if (authResult.statusCode !== 201) {
    await releaseReservation(pool, link.id, reservationToken);
    return {
      statusCode: authResult.statusCode,
      body: { stage: "authorize", ...(authResult.body as Record<string, unknown>) },
    };
  }

  const txnId = (authResult.body as { id: string }).id;

  // Step 3 — capture and finalize atomically, under the link's row lock.
  const captureKey = `paylink:${link.id}:${input.idempotencyKey}:capture`;
  const outcome = await withTransaction(pool, async (client) => {
    const locked = await client.query<{ status: string; reservation_token: string | null }>(
      `SELECT status, reservation_token FROM payment_links WHERE id = $1 FOR UPDATE`,
      [link.id],
    );
    const current = locked.rows[0];
    if (!current || current.status !== "reserved" || current.reservation_token !== reservationToken) {
      // Another attempt took the link over while we were authorizing. It is
      // now that attempt's to pay; we must not charge this card.
      return { kind: "lost" as const };
    }

    // Capture the full remaining amount (amountFils omitted) — correct here,
    // since this transaction was just authorized for exactly link.amountFils.
    const captureResult = await captureTransactionWithClient(client, acquirer, {
      transactionId: txnId,
      merchantId: link.merchantId,
      idempotencyKey: captureKey,
      actor: { type: "system", id: link.id },
    });

    if (captureResult.statusCode !== 200) {
      await client.query(
        `UPDATE payment_links SET status = 'active', reserved_at = NULL, reservation_token = NULL WHERE id = $1`,
        [link.id],
      );
      return { kind: "capture_failed" as const, result: captureResult };
    }

    // This fresh, fully captured transaction has exactly one capture event.
    // Post its rebate before marking the link paid or publishing the capture.
    const adjustments = await applyCaptureDiscountAdjustmentWithClient(client, {
      merchantId: link.merchantId,
      transactionId: txnId,
    });
    if (adjustments.length !== 1) {
      throw new Error("payPaymentLink: expected one newly adjusted capture");
    }
    const adjustment = adjustments[0]!;
    await client.query(
      `UPDATE transaction_events SET metadata = metadata || jsonb_build_object(
         'feeBeforeDiscountFils', $2::bigint, 'feeFils', $3::bigint)
       WHERE id = $1`,
      [adjustment.captureEventId, adjustment.feeBeforeDiscountFils, adjustment.feeFils],
    );
    await client.query(
      `UPDATE outbox_events SET payload = payload || jsonb_build_object('feeFils', $2::bigint)
       WHERE aggregate_id = $1 AND event_type = 'transaction.captured'`,
      [txnId, adjustment.feeFils],
    );

    const finalized = await client.query<{ paid_at: Date }>(
      `UPDATE payment_links
          SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL, reservation_token = NULL
        WHERE id = $1
        RETURNING paid_at`,
      [link.id, txnId],
    );
    return { kind: "paid" as const, paidAt: finalized.rows[0]!.paid_at };
  }).catch(releaseThenRethrow(pool, link.id, reservationToken));

  if (outcome.kind === "lost") {
    // Nothing was captured, so the cardholder was not charged. Release the
    // hold on their card instead of leaving the authorization open.
    await voidTransaction(pool, {
      transactionId: txnId,
      merchantId: link.merchantId,
      actor: { type: "system", id: link.id },
    }).catch((err: unknown) => {
      console.error(`payPaymentLink: could not void superseded authorization ${txnId} for link ${link.id}`, err);
    });
    const explained = await classifyClaimFailure(pool, input.token);
    return { statusCode: 409, body: { stage: "capture", ...(explained.body as Record<string, unknown>) } };
  }

  if (outcome.kind === "capture_failed") {
    return {
      statusCode: outcome.result.statusCode,
      body: { stage: "capture", ...(outcome.result.body as Record<string, unknown>) },
    };
  }

  return {
    statusCode: 200,
    body: {
      status: "paid",
      transactionId: txnId,
      amountFils: link.amountFils,
      paidAt: outcome.paidAt.toISOString(),
    },
  };
}

/** A `.catch` handler: release this attempt's reservation, then rethrow the
 *  original error. A failure to release is logged, never thrown over it. */
function releaseThenRethrow(pool: Pool, linkId: string, reservationToken: string) {
  return async (err: unknown): Promise<never> => {
    await releaseReservation(pool, linkId, reservationToken).catch((releaseErr: unknown) => {
      console.error(`payPaymentLink: could not release reservation on link ${linkId}`, releaseErr);
    });
    throw err;
  };
}

/**
 * Hands the link back after a declined or failed authorize — but only while
 * the reservation is still this attempt's own. Without the token check a
 * slow attempt could release a reservation another buyer had since taken,
 * letting a third buyer in while the second was still paying.
 */
async function releaseReservation(pool: Pool, linkId: string, reservationToken: string): Promise<void> {
  await pool.query(
    `UPDATE payment_links SET status = 'active', reserved_at = NULL, reservation_token = NULL
      WHERE id = $1 AND status = 'reserved' AND reservation_token = $2`,
    [linkId, reservationToken],
  );
}

/**
 * The claim UPDATE matched 0 rows. This second read carries no race risk —
 * nothing further is decided from it, it only explains a decision already
 * made by the failed UPDATE.
 */
// FH: "This second read carries no race risk" — Claude disagrees, says we should SELECT
// ... FOR UPDATE here. TODO
// am: its only for the error message. ignore
async function classifyClaimFailure(
  pool: Pool,
  token: string,
): Promise<PayPaymentLinkResult> {
  const result = await pool.query<LinkStatusRow & { merchant_status: string }>(
    `SELECT pl.status, pl.expires_at <= now() AS expired, m.status AS merchant_status
       FROM payment_links pl
       JOIN merchants m ON m.id = pl.merchant_id
      WHERE pl.token = $1`,
    [token],
  );
  const row = result.rows[0];

  if (!row) {
    return { statusCode: 404, body: { error: "payment_link_not_found" } };
  }
  if (row.merchant_status !== "active" && row.status !== "paid") {
    return { statusCode: 409, body: { error: "merchant_unavailable" } };
  }
  if (row.status === "paid") {
    return { statusCode: 409, body: { error: "payment_link_already_paid" } };
  }
  if (row.status === "canceled") {
    return { statusCode: 409, body: { error: "payment_link_canceled" } };
  }
  // Any unpaid, uncanceled link past expiry is expired, including one whose
  // reservation lapsed: the claim UPDATE refuses both for the same reason.
  if ((row.status === "active" || row.status === "reserved") && row.expired) {
    return { statusCode: 410, body: { error: "payment_link_expired" } };
  }
  if (row.status === "reserved" || row.status === "active") {
    // Another attempt holds the link: either its reservation is still within
    // the timeout, or it is capturing right now under the row lock (which the
    // reserve step skips). Either way it is being paid; try again shortly.
    return { statusCode: 409, body: { error: "payment_link_processing" } };
  }
  // Defensive fallback, should be unreachable given the claim UPDATE's
  // WHERE clause exactly mirrors these cases.
  return { statusCode: 409, body: { error: "payment_link_not_payable", status: row.status } };
}
