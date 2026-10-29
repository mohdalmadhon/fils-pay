package settlement

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// BatchAdjustment records an open batch's provisional fee change.
// DiffFils is NewFeeFils - OldFeeFils; it is not a posted ledger adjustment.
// Closed and paid batches are never selected.
type BatchAdjustment struct {
	BatchID    uuid.UUID
	BatchDate  time.Time
	Status     string
	OldFeeFils money.Fils
	NewFeeFils money.Fils
	DiffFils   money.Fils
}

// RecalcResult summarizes one RecalculateMDR pass.
type RecalcResult struct {
	BatchesConsidered int
	Adjusted          []BatchAdjustment
}

// batchRow is one settlement_batches row as read by the recalculation scan.
type batchRow struct {
	id            uuid.UUID
	batchDate     time.Time
	status        string
	grossFils     money.Fils
	feeFils       money.Fils
	netPayoutFils money.Fils
}

// RecalculateMDR refreshes provisional totals for existing open batches in
// [from, to). It uses the same eligible captures and fee rules as CloseBatch,
// without claiming events, posting ledger entries, or changing cached balances.
// CloseBatch remains responsible for computing and freezing the final totals.
func RecalculateMDR(ctx context.Context, db *pgxpool.Pool, merchantID uuid.UUID, from, to time.Time) (RecalcResult, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var mdrBps, discountBps int64
	err = tx.QueryRow(ctx, `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`, merchantID).
		Scan(&mdrBps, &discountBps)
	if err != nil {
		return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: load merchant: %w", err)
	}

	rows, err := tx.Query(ctx, `
		SELECT id, batch_date, status, gross_fils, fee_fils, net_payout_fils
		  FROM settlement_batches
		 WHERE merchant_id = $1 AND batch_date >= $2 AND batch_date < $3
		   AND status = 'open'
		 ORDER BY batch_date
		 FOR UPDATE
	`, merchantID, from, to)
	if err != nil {
		return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: select batches: %w", err)
	}
	var batches []batchRow
	for rows.Next() {
		var b batchRow
		var gross, fee, net int64
		if err := rows.Scan(&b.id, &b.batchDate, &b.status, &gross, &fee, &net); err != nil {
			rows.Close()
			return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: scan batch: %w", err)
		}
		b.grossFils = money.Fils(gross)
		b.feeFils = money.Fils(fee)
		b.netPayoutFils = money.Fils(net)
		batches = append(batches, b)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: iterate batches: %w", err)
	}
	rows.Close()

	var adjusted []BatchAdjustment
	if len(batches) > 0 {
		schedules, err := LoadFeeSchedules(ctx, tx, merchantID)
		if err != nil {
			return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: load fee schedules: %w", err)
		}
		processed, err := ReadAndLockPlatformProcessedFils(ctx, tx)
		if err != nil {
			return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: read platform volume: %w", err)
		}
		tierBonusBps := VolumeTierMdrBonusBps(processed)
		for _, b := range batches {
			gross, fee, err := recomputeOpenBatchTotals(ctx, tx, merchantID, b.batchDate, schedules, mdrBps, discountBps, tierBonusBps)
			if err != nil {
				return RecalcResult{}, err
			}
			net := NetPayableFils(gross, fee)
			if gross == b.grossFils && fee == b.feeFils && net == b.netPayoutFils {
				continue
			}
			// The row lock serializes this preview with CloseBatch. Keep the
			// open-state condition on the write as well as the selection.
			updated, err := tx.Exec(ctx, `
				UPDATE settlement_batches
				   SET gross_fils = $2, fee_fils = $3, net_payout_fils = $4
				 WHERE id = $1 AND status = 'open'
			`, b.id, int64(gross), int64(fee), int64(net))
			if err != nil {
				return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: update open batch %s: %w", b.id, err)
			}
			if updated.RowsAffected() != 1 {
				return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: batch %s is no longer open", b.id)
			}
			adjusted = append(adjusted, BatchAdjustment{
				BatchID: b.id, BatchDate: b.batchDate, Status: b.status,
				OldFeeFils: b.feeFils, NewFeeFils: fee, DiffFils: fee - b.feeFils,
			})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return RecalcResult{}, fmt.Errorf("settlement: RecalculateMDR: commit: %w", err)
	}
	return RecalcResult{BatchesConsidered: len(batches), Adjusted: adjusted}, nil
}

// recomputeOpenBatchTotals reads the capture events CloseBatch would claim.
// Open batches do not yet own events, so querying by settlement_batch_id
// would omit their captures and could incorrectly reset their fee to zero.
func recomputeOpenBatchTotals(ctx context.Context, tx pgx.Tx, merchantID uuid.UUID, batchDate time.Time, schedules []FeeScheduleRow, mdrBps, discountBps, tierBonusBps int64) (money.Fils, money.Fils, error) {
	start, end := BusinessDayWindow(batchDate)
	rows, err := tx.Query(ctx, `
		SELECT te.amount_fils, te.occurred_at
		  FROM transaction_events te
		  JOIN transactions t ON t.id = te.transaction_id
		 WHERE t.merchant_id = $1
		   AND te.event_type IN ('captured', 'partially_captured')
		   AND te.settlement_batch_id IS NULL
		   AND te.occurred_at >= $2 AND te.occurred_at < $3
		 ORDER BY te.transaction_id, te.occurred_at
		 FOR UPDATE OF te
	`, merchantID, start, end)
	if err != nil {
		return 0, 0, fmt.Errorf("settlement: RecalculateMDR: select open batch captures: %w", err)
	}
	defer rows.Close()

	var gross, fee money.Fils
	for rows.Next() {
		var amount int64
		var occurredAt time.Time
		if err := rows.Scan(&amount, &occurredAt); err != nil {
			return 0, 0, fmt.Errorf("settlement: RecalculateMDR: scan open batch capture: %w", err)
		}
		rate := EffectiveMdrBpsAt(schedules, occurredAt, mdrBps) - tierBonusBps
		if rate < 0 {
			rate = 0
		}
		gross += money.Fils(amount)
		fee += ComputeSettlementFee(money.Fils(amount), rate, discountBps)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("settlement: RecalculateMDR: iterate open batch captures: %w", err)
	}
	return gross, fee, nil
}
