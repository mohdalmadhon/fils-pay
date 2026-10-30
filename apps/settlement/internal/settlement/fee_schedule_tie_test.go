package settlement

import (
	"context"
	"testing"
	"time"
)

// Two schedules with the same effective_from: the later-entered one is the
// correction and wins, as in the API (getEffectiveMdrBps, the display
// helper). LoadFeeSchedules ordered by effective_from only, so which row
// settlement used depended on the order Postgres returned the tie. The
// later-entered row is inserted first here so physical order is the wrong
// answer.
func TestLoadFeeSchedules_SameEffectiveDateLaterEntryWins(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	effective := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	for _, row := range []struct {
		mdr     int64
		created time.Time
	}{
		{220, time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)}, // the correction, entered later
		{230, time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from, created_at)
			VALUES ($1, $2, $3, $4)`, merchantID, row.mdr, effective, row.created); err != nil {
			t.Fatalf("insert fee schedule: %v", err)
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	schedules, err := LoadFeeSchedules(ctx, tx, merchantID)
	if err != nil {
		t.Fatalf("LoadFeeSchedules: %v", err)
	}
	if got := EffectiveMdrBpsAt(schedules, effective.Add(24*time.Hour), 250); got != 220 {
		t.Errorf("rate = %d, want 220 (the later-entered correction)", got)
	}
}
