package money

import (
	"reflect"
	"testing"
)

// Same expectations as packages/money/src/allocate_drift_known.test.ts, so
// Go and TypeScript provably split the same way.
func TestAllocateRemainderMatchesTypeScript(t *testing.T) {
	cases := []struct {
		total   Fils
		weights []int64
		want    []Fils
	}{
		{1_001, []int64{3_333, 3_333, 3_334}, []Fils{334, 333, 334}},
		{100, []int64{1, 1, 1}, []Fils{34, 33, 33}},
		{2, []int64{1, 1, 1}, []Fils{1, 1, 0}},
		{999, []int64{0, 1, 0}, []Fils{0, 999, 0}},
		{0, []int64{5, 5}, []Fils{0, 0}},
	}
	for _, c := range cases {
		if got := AllocateRemainder(c.total, c.weights); !reflect.DeepEqual(got, c.want) {
			t.Errorf("AllocateRemainder(%d, %v) = %v, want %v", c.total, c.weights, got, c.want)
		}
	}
}

func TestAllocateRemainderAlwaysSumsToTotal(t *testing.T) {
	weightSets := [][]int64{{3_333, 3_333, 3_334}, {1, 2, 3, 4}, {7_000, 2_999, 1}, {10_000}, {1, 9_999}, {2_500, 2_500, 2_500, 2_500}}
	for _, ws := range weightSets {
		for total := Fils(0); total < 2_000; total += 7 {
			var sum Fils
			for _, s := range AllocateRemainder(total, ws) {
				if s < 0 {
					t.Fatalf("negative share for %d over %v", total, ws)
				}
				sum += s
			}
			if sum != total {
				t.Fatalf("AllocateRemainder(%d, %v) sums to %d", total, ws, sum)
			}
		}
	}
	// Large amounts don't overflow.
	big := Fils(9_000_000_000_000_000)
	var sum Fils
	for _, s := range AllocateRemainder(big, []int64{3_333, 3_333, 3_334}) {
		sum += s
	}
	if sum != big {
		t.Fatalf("large total sums to %d, want %d", sum, big)
	}
}
