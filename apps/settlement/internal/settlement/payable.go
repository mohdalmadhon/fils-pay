package settlement

import (
	"github.com/filspay/settlement/internal/money"
)

// NetPayableFils derives the net payout from frozen gross and fee totals:
// gross minus fee, in integer fils, exactly.
//
// It used to compute float32(gross)/1000 - float32(fee)/1000 and round back
// to fils. float32 holds about 7 significant digits, so from roughly
// 16,384 BD a batch's net could be off by a fil or more (123,456.789 BD
// netted 2 fils short). CLAUDE.md's own rule is float32 for display only,
// int64 for anything that feeds a calculation; this feeds every payout.
// See docs/improvements/04-net-payout-float32.md and
// docs/solved-problems/014-net-payout-integer-fils.md (the same fix, made
// independently on main).
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
