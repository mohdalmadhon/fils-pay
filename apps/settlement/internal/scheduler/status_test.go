package scheduler

import (
	"testing"
	"time"
)

func TestEstimateNextRunAt(t *testing.T) {
	t.Setenv("TZ", "UTC")

	lastCheckedAt := time.Date(2026, 5, 14, 21, 15, 0, 0, time.UTC)
	// 21:15 UTC is 00:15 in Bahrain: with a 15-minute delay that is the
	// close itself, so the next one is a day later.
	got := estimateNextRunAt(lastCheckedAt, 15)
	want := time.Date(2026, 5, 15, 21, 15, 0, 0, time.UTC)

	if !got.Equal(want) {
		t.Fatalf("estimateNextRunAt(%s) = %s, want %s", lastCheckedAt.Format(time.RFC3339), got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func TestSchedulingLocationUsesTZ(t *testing.T) {
	t.Setenv("TZ", "UTC")

	if got := schedulingLocation().String(); got != "UTC" {
		t.Fatalf("schedulingLocation() = %q, want %q", got, "UTC")
	}
}
