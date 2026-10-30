package settlement

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A batch closed while the merchant was active must not be paid once the
// merchant is suspended or put in test mode: RunDailyBatch pays whatever
// CloseBatch returns, so CloseBatch has to refuse even an already-closed
// batch for an ineligible merchant.
func TestRunDailyBatch_DoesNotPayAClosedBatchOfAnIneligibleMerchant(t *testing.T) {
	for _, tc := range []struct{ name, update string }{
		{"suspended", `UPDATE merchants SET status = 'suspended' WHERE id = $1`},
		{"test mode", `UPDATE merchants SET test_mode = true WHERE id = $1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool := mustPool(t)
			ctx := context.Background()
			const mdrBps = 250
			merchantID := insertActiveMerchant(t, pool, mdrBps)
			businessDate := time.Date(2026, 2, 16, 0, 0, 0, 0, time.UTC)
			start, _ := BusinessDayWindow(businessDate)
			insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(time.Hour))

			closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
			if err != nil {
				t.Fatalf("CloseBatch: %v", err)
			}
			if _, err := pool.Exec(ctx, tc.update, merchantID); err != nil {
				t.Fatalf("make merchant ineligible: %v", err)
			}

			if _, err := CloseBatch(ctx, pool, merchantID, businessDate); !errors.Is(err, ErrMerchantNotEligible) {
				t.Errorf("CloseBatch on the closed batch err = %v, want ErrMerchantNotEligible", err)
			}
			if _, err := RunDailyBatch(ctx, pool, businessDate, &merchantID); err != nil {
				t.Fatalf("RunDailyBatch: %v", err)
			}
			if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE id = $1 AND status = 'closed'`, closed.BatchID); n != 1 {
				t.Errorf("batch is no longer 'closed' (paid?), want it left unpaid")
			}
			if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND description = 'settlement payout: batch paid'`, closed.BatchID); n != 0 {
				t.Errorf("%d payout ledger leg(s) posted, want 0", n)
			}
		})
	}
}
