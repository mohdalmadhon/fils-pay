package splits

import "github.com/filspay/settlement/internal/money"

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights, so
// that the shares always add up to netPayout exactly (money.AllocateRemainder).
//
// Each share used to be rounded on its own (money.ApplyRateFils per child),
// so the parts didn't add up to the whole: 1000 fils over 3333/3333/3334
// bps paid out 999, and the missing fils stayed in the parent's account.
// That is the "splits are always a few fils short".
//
// A zero or negative netPayout distributes nothing.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out := make([]money.Fils, len(children))
	if netPayout <= 0 || len(children) == 0 {
		return out
	}
	weights := make([]int64, len(children))
	for i, c := range children {
		weights[i] = c.WeightBps
	}
	return money.AllocateRemainder(netPayout, weights)
}
