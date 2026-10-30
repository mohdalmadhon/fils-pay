package settlement

import (
	"context"
	"testing"
)

// The platform-wide processed-volume counter must keep counting past
// 2,147,483,647 fils (int32 max, about 2,147,483 BD), which is only ~7 %
// above the volume-tier threshold of 2,000,000 BD. Before the fix the column
// was INTEGER and the Go code added in int32, so the total wrapped negative
// and the tier discount switched off for everyone. Runs inside a rolled-back
// transaction so the shared counter is untouched.
func TestPlatformProcessedVolume_CountsPastInt32(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 2100000000 WHERE id = 1`); err != nil {
		t.Fatalf("set counter: %v", err)
	}
	current, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	// One large day: 100,000 BD.
	if err := RecordPlatformProcessedVolume(ctx, tx, current, 100_000_000); err != nil {
		t.Fatalf("record: %v", err)
	}
	after, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("read after: %v", err)
	}
	if int64(after) != 2_200_000_000 {
		t.Fatalf("counter = %d, want 2200000000", after)
	}
	if VolumeTierMdrBonusBps(after) != 15 {
		t.Errorf("tier bonus = %d past the threshold, want 15", VolumeTierMdrBonusBps(after))
	}
}
