// Package settlement implements the daily per-merchant batching algorithm:
// eligible-event selection, MDR fee
// recomputation, scheme export line generation, and the payout ledger
// posting.
package settlement

import (
	"fmt"
	"time"
)

// businessDayLocation is the settlement business day's fixed timezone:
// Asia/Bahrain local time (UTC+3, no DST — Bahrain has observed no
// daylight-saving transitions since 1972), loaded as a named IANA zone and
// held in an unexported package var, never read from configuration.
//
// Why hardcoded rather than configurable: FilsPay settles Bahraini Dinar;
// the merchants and the card-scheme relationship this platform models are
// Bahrain-based. A "settlement business day" has to close at this
// platform's local midnight, not the host machine's or the deploying
// engineer's. There is exactly one place this value is defined, and no
// config or TZ variable can change it.
//
// — YA: it's Asia/Bahrain.
var businessDayLocation = mustLoadLocation("Asia/Bahrain")

// mustLoadLocation panics at package init if the zone cannot be loaded.
// cmd/settlement imports time/tzdata, so it cannot fail in the shipped binary.
func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("settlement: failed to load timezone %q: %v", name, err))
	}
	return loc
}

// BusinessDayWindow returns the [start, end) UTC instants bounding the
// given calendar date's Asia/Bahrain business day, i.e. Asia/Bahrain
// 00:00:00 on `date` through Asia/Bahrain 00:00:00 on `date`+1.
//
// `date` is a calendar date, not an instant: only its year/month/day (in
// its own location) are read, so callers pass dates such as the parsed
// `--date=2026-03-24` (UTC midnight). To find which business day an
// *instant* falls in, use BusinessDateAt first: passing time.Now().UTC()
// here gives the UTC calendar day, which between Bahrain midnight and
// 03:00 is still yesterday.
func BusinessDayWindow(date time.Time) (start, end time.Time) {
	y, m, d := date.Date()
	start = time.Date(y, m, d, 0, 0, 0, 0, businessDayLocation)
	// MK: AddDate not Add(24h). leave
	end = start.AddDate(0, 0, 1)
	return start, end
}

// BusinessDateAt returns the Asia/Bahrain calendar date that `instant`
// falls on, as a date value (UTC midnight of that date) in the same form
// BusinessDayWindow and RunDailyBatch take. At 21:15 UTC on 29 Oct it is
// already 00:15 on 30 Oct in Bahrain, so this returns 30 Oct.
func BusinessDateAt(instant time.Time) time.Time {
	y, m, d := instant.In(businessDayLocation).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
