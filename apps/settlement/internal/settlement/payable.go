package settlement

import "github.com/filspay/settlement/internal/money"

// NetPayableFils derives the net payout from frozen gross and fee totals.
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	// Both totals are already integer fils; converting to BD loses precision.
	return grossFils - feeFils
}
