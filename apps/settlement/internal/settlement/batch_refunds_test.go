package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// insertRefund inserts a succeeded refund (and the ledger legs
// processRefund.ts posts for it) against txnID.
func insertRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, amountFils, feeReversedFils money.Fils, occurredAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
		                     acquirer_reference, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', $5, 'merchant_api_key', $6, $7)
		RETURNING id
	`, txnID, merchantID, int64(amountFils), int64(feeReversedFils), "rf-"+uuid.New().String(), uuid.New(), occurredAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertRefund: %v", err)
	}
	groupID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, $3, 'merchant_payable', 'debit', $4, $5, 'refund: gross'),
		       ($1, $2, $3, 'card_scheme_clearing', 'credit', $4, $5, 'refund: gross')
	`, groupID, merchantID, txnID, int64(amountFils), occurredAt); err != nil {
		t.Fatalf("insertRefund: gross legs: %v", err)
	}
	if feeReversedFils > 0 {
		if _, err := pool.Exec(ctx, `
			INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
			VALUES ($1, $2, $3, 'platform_fee_revenue', 'debit', $4, $5, 'refund: MDR fee reversal'),
			       ($1, $2, $3, 'merchant_payable', 'credit', $4, $5, 'refund: MDR fee reversal')
		`, groupID, merchantID, txnID, int64(feeReversedFils), occurredAt); err != nil {
			t.Fatalf("insertRefund: fee legs: %v", err)
		}
	}
	return id
}

func refundBatchID(t *testing.T, pool *pgxpool.Pool, refundID uuid.UUID) *uuid.UUID {
	t.Helper()
	var id *uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, refundID).Scan(&id); err != nil {
		t.Fatalf("read refund: %v", err)
	}
	return id
}

func merchantPayable(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&n); err != nil {
		t.Fatalf("merchantPayable: %v", err)
	}
	return n
}

// A refund already debited merchant_payable, so the batch must pay that
// much less, and the ledger must end at zero after the payout.
func TestCloseBatch_DeductsRefundsFromPayout(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 2, 10, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(time.Hour))
	refundID := insertRefund(t, pool, merchantID, txnID, 4_000, 100, start.Add(2*time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	wantNet := money.Fils(10_000) - fee - (4_000 - 100)
	if result.NetPayoutFils != wantNet {
		t.Errorf("NetPayoutFils = %d, want %d (captures - fee - (refund - fee reversed))", result.NetPayoutFils, wantNet)
	}
	if result.GrossFils != 10_000 || result.FeeFils != fee {
		t.Errorf("gross/fee = %d/%d, want 10000/%d (refunds only change the net)", result.GrossFils, result.FeeFils, fee)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != result.BatchID {
		t.Errorf("refund settlement_batch_id = %v, want %s", got, result.BatchID)
	}
	if _, err := PayoutBatch(context.Background(), pool, result.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if p := merchantPayable(t, pool, merchantID); p != 0 {
		t.Errorf("merchant_payable after payout = %d, want 0", p)
	}
}

// A refund bigger than the batch's net is not claimed (net stays >= 0) and
// is taken by the next batch that can cover it.
func TestCloseBatch_CarriesForwardARefundTheBatchCannotCover(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 2, 11, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	oldTxn, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 20_000, start1.Add(-48*time.Hour))
	// The old capture is settled by its own batch, so only the refund is new.
	if _, err := CloseBatch(context.Background(), pool, merchantID, day1.AddDate(0, 0, -2)); err != nil {
		t.Fatalf("CloseBatch(old day): %v", err)
	}

	_, fee1 := insertCaptureEvent(t, pool, merchantID, mdrBps, 1_000, start1.Add(time.Hour))
	bigRefund := insertRefund(t, pool, merchantID, oldTxn, 5_000, 125, start1.Add(2*time.Hour))

	first, err := CloseBatch(context.Background(), pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch(day1): %v", err)
	}
	if first.NetPayoutFils != 1_000-fee1 || first.RefundCount != 0 {
		t.Errorf("day1 net = %d with %d refund(s), want %d and 0 (refund carried forward)", first.NetPayoutFils, first.RefundCount, 1_000-fee1)
	}
	if got := refundBatchID(t, pool, bigRefund); got != nil {
		t.Errorf("refund claimed by day1 batch %s, want it left for a later batch", *got)
	}

	_, fee2 := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start2.Add(time.Hour))
	second, err := CloseBatch(context.Background(), pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch(day2): %v", err)
	}
	if want := money.Fils(10_000) - fee2 - 4_875; second.NetPayoutFils != want || second.RefundCount != 1 {
		t.Errorf("day2 net = %d with %d refund(s), want %d and 1", second.NetPayoutFils, second.RefundCount, want)
	}
	if got := refundBatchID(t, pool, bigRefund); got == nil || *got != second.BatchID {
		t.Errorf("refund settlement_batch_id = %v, want day2 batch %s", got, second.BatchID)
	}
}
