package settlement

import (
	"context"
	"testing"
	"time"
)

// A large day closes with net = gross - fee to the fil, end to end through
// CloseBatch (the float32 net used to come out 2 fils short here).
func TestCloseBatch_LargeBatchNetIsExact(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 123_456_789, start.Add(time.Hour))

	res, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if res.GrossFils != 123_456_789 {
		t.Fatalf("gross = %d, want 123456789", res.GrossFils)
	}
	if res.NetPayoutFils != res.GrossFils-res.FeeFils {
		t.Errorf("net = %d, want gross - fee = %d", res.NetPayoutFils, res.GrossFils-res.FeeFils)
	}
	var stored int64
	if err := pool.QueryRow(ctx, `SELECT net_payout_fils FROM settlement_batches WHERE id = $1`, res.BatchID).Scan(&stored); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if stored != int64(res.GrossFils-res.FeeFils) {
		t.Errorf("stored net_payout_fils = %d, want %d", stored, res.GrossFils-res.FeeFils)
	}
}
