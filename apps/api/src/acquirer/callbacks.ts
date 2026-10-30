import type { Pool } from "pg";
import { AppError, NotFoundError } from "../lib/errors.js";

/** @property outcome Validated against the two allowed values by the route (routes/acquirerCallbacks.ts). */
export interface AcquirerCallbackInput {
  callbackId: string;
  type: "fraud_review.completed";
  transactionId: string;
  occurredAt: string;
  outcome: "cleared" | "confirmed_fraud";
  note: string;
}

interface TransactionMerchantRow {
  merchant_id: string;
}

/**
 * Applies one acquirer callback: looks up the transaction it refers to and
 * appends a note recording the acquirer's own delayed verdict.
 * acquirer_callback_notes is append-only and surfaced on the transaction
 * timeline for support/finance to read — a fraud-review verdict is
 * informational, not a state transition, so this never touches
 * transactions.status or the ledger; a confirmed-fraud outcome still needs
 * a human decision to void/refund, exactly as today.
 *
 * Idempotent per (transaction, callbackId): the acquirer redelivers a
 * callback when our acknowledgement is slow, and a redelivery must not save a
 * second note. The unique index from migration 0073 enforces this, so it holds
 * even for concurrent redeliveries and for withCallbackRetry re-running this
 * function. Returns `duplicate: true` when the callback had already been saved.
 */
export async function applyAcquirerCallback(
  pool: Pool,
  callback: AcquirerCallbackInput,
): Promise<{ duplicate: boolean }> {
  const txnResult = await pool.query<TransactionMerchantRow>(
    `SELECT merchant_id FROM transactions WHERE id = $1`,
    [callback.transactionId],
  );
  const txnRow = txnResult.rows[0];
  if (!txnRow) {
    throw new NotFoundError("transaction_not_found");
  }

  const inserted = await pool.query(
    `INSERT INTO acquirer_callback_notes
        (transaction_id, merchant_id, callback_id, callback_type, outcome, note, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (transaction_id, callback_id) DO NOTHING`,
    [
      callback.transactionId,
      txnRow.merchant_id,
      callback.callbackId,
      callback.type,
      callback.outcome,
      callback.note,
      callback.occurredAt,
    ],
  );
  return { duplicate: (inserted.rowCount ?? 0) === 0 };
}

/**
 * Defaults: 3 attempts, 50 ms apart.
 * — FH
 */
export interface CallbackRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export async function withCallbackRetry<T>(fn: () => Promise<T>, options: CallbackRetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delayMs = options.delayMs ?? 50;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // An AppError (404 unknown transaction, a 4xx) is an answer, not a
      // passing failure: retrying can't change it. Only unexpected errors
      // (a dropped connection, a deadlock) are retried. docs/bugs/013.
      if (err instanceof AppError) break;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}
