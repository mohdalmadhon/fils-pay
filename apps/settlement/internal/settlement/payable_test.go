package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// Net payout is gross minus fee, in integer fils, exactly. It used to go
// through float32 BD values, which hold only ~7 significant digits: from
// about 16,384 BD a batch's net could be off by one or more fils, and from
// 100,000 BD by several. No database needed.
func TestNetPayableFils_IsExactIntegerSubtraction(t *testing.T) {
	cases := []struct{ gross, fee money.Fils }{
		{47_333, 1_065},
		{16_777_217, 377_487},     // 16,777.217 BD: past float32's exact range in BD
		{123_456_789, 3_086_420},  // 123,456.789 BD
		{999_999_999, 22_499_999}, // just under 1,000,000 BD
		{9_007_199_254, 0},        // 9 million BD, a large month
		{0, 0},
	}
	for _, c := range cases {
		if got, want := NetPayableFils(c.gross, c.fee), c.gross-c.fee; got != want {
			t.Errorf("NetPayableFils(%d, %d) = %d, want %d (off by %d fils)", c.gross, c.fee, got, want, got-want)
		}
	}
}
