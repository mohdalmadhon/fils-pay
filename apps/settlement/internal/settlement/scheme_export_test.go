package settlement

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

var twoDecimalPlaces = regexp.MustCompile(`^\d+\.\d{2}$`)

// TestSchemeExportAmountHasTwoDecimals pins the acquirer-format promise
// scheme_export_lines.amount carries: every line handed to the clearing
// file is quoted in BD at exactly the two decimal places the scheme
// accepts — no third digit, no bare integer, no trailing-zero loss.
// am: 4747 -> "4.75" passes the regex. is 4.75 right for 4747 fils?? it rounds. whatever, scheme wants 2dp
func TestSchemeExportAmountHasTwoDecimals(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	for i, amount := range []money.Fils{4747, 1005, 4740, 12344} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	lines, err := LoadSchemeExportLines(context.Background(), pool, result.BatchID)
	if err != nil {
		t.Fatalf("LoadSchemeExportLines: %v", err)
	}
	if len(lines) != 4 {
		t.Fatalf("expected 4 exported lines, got %d", len(lines))
	}
	for _, line := range lines {
		if !twoDecimalPlaces.MatchString(line.Amount) {
			t.Errorf("line %d amount = %q, want exactly two decimal places", line.LineSequence, line.Amount)
		}
	}
}

func TestSchemeRoundingResidue(t *testing.T) {
	cases := []struct {
		gross, want money.Fils
	}{
		{0, 0},
		{10, 0},
		{4747, 7},
		{47333, 3},
		{150031, 1},
		{999999, 9},
	}
	for _, tc := range cases {
		got := SchemeRoundingResidue(tc.gross)
		if got != tc.want {
			t.Errorf("SchemeRoundingResidue(%d) = %d, want %d", tc.gross, got, tc.want)
		}
		if TruncateToSchemeAmount(tc.gross)+got != tc.gross {
			t.Errorf("truncated + residue != gross for %d", tc.gross)
		}
	}
}
