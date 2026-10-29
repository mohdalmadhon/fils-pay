package money

import (
	"fmt"
	"math/big"
	"sort"
)

// AllocateRemainder splits total into len(weights) integer-fils shares in
// proportion to weights, with the guarantees of packages/money's
// allocateRemainder (TypeScript), which it mirrors exactly:
//
//   - every share is >= 0
//   - the shares sum to total, exactly, always
//   - leftover fils go to the largest remainders first, ties broken by
//     ascending index, so the result is deterministic and Go and TypeScript
//     agree on it
//
// Rounding each share on its own (ApplyRateFils per share) does not have the
// second property: three children at 3333/3333/3334 bps of 1001 fils get
// 334 + 334 + 334 = 1002, and of 1000 fils 333 + 333 + 333 = 999.
//
// It panics on an empty slice, a negative weight, all-zero weights or a
// negative total, all of which are programming errors at the call site.
func AllocateRemainder(total Fils, weights []int64) []Fils {
	if len(weights) == 0 {
		panic("money.AllocateRemainder: weights must not be empty")
	}
	if total < 0 {
		panic(fmt.Sprintf("money.AllocateRemainder: total must be non-negative, got %d", total))
	}
	var sum int64
	for _, w := range weights {
		if w < 0 {
			panic(fmt.Sprintf("money.AllocateRemainder: weights must be non-negative, got %d", w))
		}
		sum += w
	}
	if sum == 0 {
		panic("money.AllocateRemainder: weights must not all be zero")
	}

	// big.Int so total*weight can never overflow int64.
	bigTotal := big.NewInt(int64(total))
	bigSum := big.NewInt(sum)
	shares := make([]Fils, len(weights))
	remainders := make([]*big.Int, len(weights))
	var allocated int64
	for i, w := range weights {
		product := new(big.Int).Mul(bigTotal, big.NewInt(w))
		base, rem := new(big.Int).QuoRem(product, bigSum, new(big.Int))
		shares[i] = Fils(base.Int64())
		remainders[i] = rem
		allocated += base.Int64()
	}

	order := make([]int, len(weights))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		return remainders[order[a]].Cmp(remainders[order[b]]) > 0
	})
	for k := int64(0); k < int64(total)-allocated; k++ {
		shares[order[k]]++
	}
	return shares
}
