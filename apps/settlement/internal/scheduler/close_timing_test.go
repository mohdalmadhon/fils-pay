package scheduler

import (
	"testing"
	"time"

	"github.com/filspay/settlement/internal/settlement"
)

// The daily close must run DaemonRunDelayMinutes after *Bahrain* midnight
// (ARCHITECTURE.md: "closes the previous business day shortly after local
// midnight"). It used to run at UTC midnight + delay, about 03:15 Bahrain
// time, because the decision used the UTC calendar date.

var bahrain = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Bahrain")
	if err != nil {
		panic(err)
	}
	return loc
}()

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.ParseInLocation("2006-01-02 15:04", s, bahrain)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDueBusinessDate(t *testing.T) {
	const delay = 15
	cases := []struct {
		bahrainNow string
		wantDue    bool
		wantDate   string
	}{
		{"2026-10-30 00:05", false, ""},          // inside the grace period
		{"2026-10-30 00:15", true, "2026-10-29"}, // the close: 21:15 UTC on the 29th
		{"2026-10-30 00:20", true, "2026-10-29"}, // the old code said "2026-10-28" here
		{"2026-10-30 02:59", true, "2026-10-29"}, // still before UTC midnight
		{"2026-10-30 03:15", true, "2026-10-29"}, // after UTC midnight: unchanged
		{"2026-10-30 23:59", true, "2026-10-29"}, // all day long, the same day
		{"2027-01-01 00:15", true, "2026-12-31"}, // across a year boundary
	}
	for _, c := range cases {
		now := at(t, c.bahrainNow)
		for _, asGiven := range []time.Time{now, now.UTC()} { // the location of `now` must not matter
			date, due := dueBusinessDate(asGiven, delay)
			if due != c.wantDue {
				t.Fatalf("%s (%s): due = %v, want %v", c.bahrainNow, asGiven.Location(), due, c.wantDue)
			}
			if due && date.Format("2006-01-02") != c.wantDate {
				t.Fatalf("%s (%s): business date = %s, want %s", c.bahrainNow, asGiven.Location(), date.Format("2006-01-02"), c.wantDate)
			}
		}
	}
}

// The day it decides to close must be exactly the Bahrain day that ended at
// the most recent Bahrain midnight.
func TestDueBusinessDateClosesTheDayThatJustEnded(t *testing.T) {
	now := at(t, "2026-10-30 00:16")
	date, due := dueBusinessDate(now, 15)
	if !due {
		t.Fatal("expected the close to be due")
	}
	_, end := settlement.BusinessDayWindow(date)
	if want := at(t, "2026-10-30 00:00"); !end.Equal(want) {
		t.Fatalf("closing a day that ends at %s, want %s", end.In(bahrain), want)
	}
}

func TestBusinessDateAt(t *testing.T) {
	// 21:15 UTC on the 29th is already the 30th in Bahrain.
	got := settlement.BusinessDateAt(time.Date(2026, 10, 29, 21, 15, 0, 0, time.UTC))
	if got.Format("2006-01-02") != "2026-10-30" {
		t.Fatalf("BusinessDateAt = %s, want 2026-10-30", got.Format("2006-01-02"))
	}
	// 20:59 UTC is still the 29th.
	got = settlement.BusinessDateAt(time.Date(2026, 10, 29, 20, 59, 0, 0, time.UTC))
	if got.Format("2006-01-02") != "2026-10-29" {
		t.Fatalf("BusinessDateAt = %s, want 2026-10-29", got.Format("2006-01-02"))
	}
}

func TestNextRunEstimateIsTheNextClose(t *testing.T) {
	t.Setenv("TZ", "Asia/Bahrain")
	got := estimateNextRunAt(at(t, "2026-10-29 22:00"), 15)
	if want := at(t, "2026-10-30 00:15"); !got.Equal(want) {
		t.Fatalf("next close = %s, want %s", got, want)
	}
	got = estimateNextRunAt(at(t, "2026-10-30 00:05"), 15)
	if want := at(t, "2026-10-30 00:15"); !got.Equal(want) {
		t.Fatalf("next close = %s, want %s", got, want)
	}
}
