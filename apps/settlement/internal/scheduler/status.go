// Package scheduler — status.go. Lightweight operational logging only:
// estimates, for an operator tailing the daemon's logs, roughly when the
// next check-in will happen. This is informational — it has no bearing
// on runIfDue's actual decision (settlement.BusinessDayWindow, in
// internal/settlement/window.go, remains the sole authority on whether a
// business day has completed) — added purely so the daemon's own log
// output says something more useful than "checked, nothing due yet" on
// every tick.
package scheduler

import (
	"log"
	"os"
	"time"

	"github.com/filspay/settlement/internal/settlement"
)

// schedulingLocation is the zone this log estimate renders in. Reads the
// process's TZ setting (the same convention every other timestamp this
// service logs already follows via Go's default time formatting), falling
// back to the container's local zone when TZ is unset — kept independent
// of internal/settlement's own businessDayLocation, which is a private
// var of that package and not reachable from here.
// Only for rendering the log line; the instant itself is computed in
// Asia/Bahrain terms by estimateNextRunAt.
func schedulingLocation() *time.Location {
	if tz := os.Getenv("TZ"); tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	return time.Local
}

// estimateNextRunAt gives a log-only estimate of when the daemon will next
// close a business day: today's Bahrain midnight plus the run delay if that
// is still ahead, otherwise tomorrow's. It is never consulted by runIfDue,
// but it uses the same rule (dueBusinessDate), so the log line tells the
// truth. It used to print "last check-in + 24 h", which says nothing about
// when the close actually happens.
func estimateNextRunAt(lastCheckedAt time.Time, runDelayMinutes int) time.Time {
	today := settlement.BusinessDateAt(lastCheckedAt)
	todayStart, _ := settlement.BusinessDayWindow(today)
	next := todayStart.Add(time.Duration(runDelayMinutes) * time.Minute)
	if !lastCheckedAt.Before(next) {
		next = next.AddDate(0, 0, 1)
	}
	return next.In(schedulingLocation())
}

// logNextRunEstimate writes the estimate to the daemon's log, alongside
// the outcome of the check that just ran.
func logNextRunEstimate(lastCheckedAt time.Time, runDelayMinutes int) {
	log.Printf("settlement daemon: next daily close ~%s", estimateNextRunAt(lastCheckedAt, runDelayMinutes).Format(time.RFC3339))
}
