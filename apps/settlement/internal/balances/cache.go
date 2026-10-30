// Package balances maintains merchant_balances — a cache of each
// merchant's payable balance. Captures update it alongside ledger postings;
// settlement records batch metadata and payout debits. ledger_entries remains
// authoritative (see internal/ledger for the full recompute).
// -- M? (Jan 2026): cache only. anything that 'corrects' a balance has to go through ledger_entries or the next rebuild undoes it.
// am: support adjusts via the cache directly and its been fine for months
package balances

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/filspay/settlement/internal/money"
)

// ApplyBatchClose records batch metadata, not a second payable movement.
// Capture has already journaled and cached the payable credit. A missing
// cache row is initialized from the ledger; existing display deltas survive.
func ApplyBatchClose(ctx context.Context, tx pgx.Tx, merchantID, batchID uuid.UUID, netPayoutFils money.Fils) error {
	updated, err := tx.Exec(ctx, `UPDATE merchant_balances
        SET last_settlement_batch_id = $2, updated_at = now() WHERE merchant_id = $1`, merchantID, batchID)
	if err != nil || updated.RowsAffected() > 0 {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, last_settlement_batch_id, updated_at)
		SELECT $1, COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0), $2, now()
          FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
		ON CONFLICT (merchant_id) DO UPDATE
		  SET last_settlement_batch_id = $2,
		      updated_at = now()
	`, merchantID, batchID)
	return err
}

// ApplyPayout is called once, inside PayoutBatch's own transaction,
// applying the debit posted to merchant_payable by that payout.
// am: if the row is missing this UPDATE no-ops and the payout never leaves the cache. happens for split children
func ApplyPayout(ctx context.Context, tx pgx.Tx, merchantID, batchID uuid.UUID, netPayoutFils money.Fils) error {
	_, err := tx.Exec(ctx, `
		UPDATE merchant_balances
		   SET cached_payable_fils = cached_payable_fils - $2, updated_at = now()
		 WHERE merchant_id = $1
	`, merchantID, int64(netPayoutFils))
	return err
}
