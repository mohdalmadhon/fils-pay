package splits

import (
	"fmt"
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout exactly using largest remainders.
// Equal remainders favor the earlier child. It panics for a negative payout,
// empty children, nonpositive weights, or weights not totaling 10000 bps.
// Database callers use allocateChildShares to return validation errors.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out, err := allocateChildShares(netPayout, children)
	if err != nil {
		panic(err)
	}
	return out
}

func allocateChildShares(netPayout money.Fils, children []ChildWeight) ([]money.Fils, error) {
	if netPayout < 0 {
		return nil, fmt.Errorf("splits: net payout must be nonnegative")
	}
	if len(children) == 0 {
		return nil, fmt.Errorf("splits: at least one child is required")
	}
	var totalWeight int64
	for _, c := range children {
		if c.WeightBps <= 0 || c.WeightBps > 10000 {
			return nil, fmt.Errorf("splits: child weight must be between 1 and 10000 bps, got %d", c.WeightBps)
		}
		totalWeight += c.WeightBps
		if totalWeight > 10000 {
			return nil, fmt.Errorf("splits: child weights exceed 10000 bps")
		}
	}
	if totalWeight != 10000 {
		return nil, fmt.Errorf("splits: child weights total %d bps, expected 10000", totalWeight)
	}

	out := make([]money.Fils, len(children))
	remainders := make([]int64, len(children))
	order := make([]int, len(children))
	var allocated money.Fils
	for i, c := range children {
		// Divide first to avoid overflowing netPayout * WeightBps. Both
		// terms stay within int64 even when netPayout is MaxInt64.
		whole := int64(netPayout) / 10000 * c.WeightBps
		fraction := int64(netPayout) % 10000 * c.WeightBps
		out[i] = money.Fils(whole + fraction/10000)
		remainders[i] = fraction % 10000
		order[i] = i
		allocated += out[i]
	}
	sort.SliceStable(order, func(i, j int) bool {
		return remainders[order[i]] > remainders[order[j]]
	})
	leftover := int(netPayout - allocated) // strictly less than len(children)
	for _, i := range order[:leftover] {
		out[i]++
	}
	return out, nil
}
