package settlement

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Incident 2026-08-21: the daemon's tick and a manual `run-batch` ran
// EnqueuePayoutNotifications at the same moment. Both read "no settlement.paid
// event yet" for the same batches and both inserted one, so merchants got two
// "your payout is on the way" webhooks (two outbox rows, two different outbox
// event ids) and two disbursement records.
func TestEnqueuePayoutNotificationsConcurrentRunsEnqueueOnce(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	merchantID := insertActiveMerchant(t, pool, 250)
	base := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	const batchCount = 40
	batches := make([]uuid.UUID, 0, batchCount)
	for i := 0; i < batchCount; i++ {
		batches = append(batches, insertBatch(t, pool, merchantID, base.AddDate(0, 0, -i), "paid", int64(10_000+i)))
	}

	const runners = 6
	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make(chan error, runners)
	totals := make(chan int, runners)
	for r := 0; r < runners; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			n, err := EnqueuePayoutNotifications(ctx, pool)
			if err != nil {
				errs <- err
				return
			}
			totals <- n
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	close(totals)
	for err := range errs {
		t.Fatalf("concurrent EnqueuePayoutNotifications: %v", err)
	}

	for _, id := range batches {
		if got := countPaidEvents(t, pool, id); got != 1 {
			t.Fatalf("batch %s: expected exactly 1 settlement.paid event after %d concurrent runs, got %d", id, runners, got)
		}
	}

	// The returned counts must report what was really enqueued: across all
	// runners, never more than one per batch.
	var ours int
	err := pool.QueryRow(ctx, `
		SELECT count(*) FROM outbox_events
		 WHERE event_type = 'settlement.paid' AND aggregate_id = ANY($1)
	`, batches).Scan(&ours)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if ours != batchCount {
		t.Fatalf("expected %d settlement.paid events in total, got %d", batchCount, ours)
	}
}
