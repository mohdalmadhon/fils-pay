package internalapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/ledger"
)

// Regression tests for "balance cache wrong after admin rebuild".
//
// The admin console's Rebuild cached balances button calls
// POST /internal/rebuild-balances. It used to recompute balances from
// scheme_export_lines (gross amounts of batched captures only) while the
// `settlement rebuild-balances` CLI sums ledger_entries. For a merchant with
// fees, payouts and not-yet-batched captures the two disagree wildly; a
// merchant whose ledger payable was 135,000 BD was cut to 7,000 BD. Both
// paths must now produce the same ledger-derived figure.

func postLedgerPair(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, payableDirection, otherAccount string, amountFils int64) {
	t.Helper()
	otherDirection := "debit"
	if payableDirection == "debit" {
		otherDirection = "credit"
	}
	_, err := pool.Exec(context.Background(), `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, 'merchant_payable', $3, $4, now(), 'rebuild-source test'),
		       ($1, $2, $5, $6, $4, now(), 'rebuild-source test')
	`, uuid.New(), merchantID, payableDirection, amountFils, otherAccount, otherDirection)
	if err != nil {
		t.Fatalf("postLedgerPair: %v", err)
	}
}

func insertBatchWithExportLine(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, batchDate, status string, amountFils int64) {
	t.Helper()
	var batchID uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, $2, $3, $4, 0, $4, now())
		RETURNING id
	`, merchantID, batchDate, status, amountFils).Scan(&batchID)
	if err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO scheme_export_lines (settlement_batch_id, transaction_id, amount_fils, line_sequence)
		VALUES ($1, $2, $3, 1)
	`, batchID, txnID, amountFils)
	if err != nil {
		t.Fatalf("insert scheme export line: %v", err)
	}
}

// seedMerchantWithRealisticHistory builds a merchant whose true (ledger)
// payable is 135,000.000 BD but whose batched scheme-export gross is only
// 17,000.000 BD:
//   - an older 10,000 BD capture, batched and already paid out
//   - a 7,000 BD capture, batched (closed) but not yet paid, minus its fee
//   - 128,175 BD of recent captures not yet in any batch
func seedMerchantWithRealisticHistory(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, int64) {
	t.Helper()
	merchantID := insertActiveMerchant(t, pool)
	when := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)

	paidTxn := insertCaptureEvent(t, pool, merchantID, 10_000_000, when)
	insertBatchWithExportLine(t, pool, merchantID, paidTxn, "2026-09-01", "paid", 10_000_000)
	postLedgerPair(t, pool, merchantID, "debit", "platform_cash", 10_000_000) // payout

	closedTxn := insertCaptureEvent(t, pool, merchantID, 7_000_000, when.AddDate(0, 0, 1))
	insertBatchWithExportLine(t, pool, merchantID, closedTxn, "2026-09-02", "closed", 7_000_000)
	postLedgerPair(t, pool, merchantID, "debit", "platform_fee_revenue", 175_000) // MDR fee

	insertCaptureEvent(t, pool, merchantID, 80_000_000, when.AddDate(0, 0, 3))
	insertCaptureEvent(t, pool, merchantID, 48_175_000, when.AddDate(0, 0, 3))

	return merchantID, 135_000_000
}

func TestRebuildBalancesEndpoint_UsesTheLedgerNotSchemeExportLines(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)
	merchantID, wantFils := seedMerchantWithRealisticHistory(t, pool)

	_, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, $2, now())
	`, merchantID, wantFils)
	if err != nil {
		t.Fatalf("seed correct cache: %v", err)
	}

	resp := post(t, server, "/internal/rebuild-balances", "Bearer "+testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var diffs map[string]rebuildDiffResponse
	decodeJSON(t, resp, &diffs)

	diff, ok := diffs[merchantID.String()]
	if !ok {
		t.Fatalf("response has no entry for merchant %s", merchantID)
	}
	if diff.After != wantFils {
		t.Errorf("after = %d, want %d (the ledger balance)", diff.After, wantFils)
	}
	if diff.Changed {
		t.Errorf("changed = true, but the cache already held the correct ledger balance")
	}

	var persisted int64
	if err := pool.QueryRow(context.Background(),
		`SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID,
	).Scan(&persisted); err != nil {
		t.Fatalf("read persisted balance: %v", err)
	}
	if persisted != wantFils {
		t.Errorf("persisted cached_payable_fils = %d, want %d", persisted, wantFils)
	}
}

func TestRebuildBalancesEndpoint_AgreesWithTheCLI(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)
	merchantID, _ := seedMerchantWithRealisticHistory(t, pool)

	resp := post(t, server, "/internal/rebuild-balances", "Bearer "+testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var diffs map[string]rebuildDiffResponse
	decodeJSON(t, resp, &diffs)

	// `settlement rebuild-balances --merchant=<id>` prints exactly this.
	cli, err := ledger.RebuildMerchantBalance(context.Background(), pool, merchantID)
	if err != nil {
		t.Fatalf("RebuildMerchantBalance: %v", err)
	}
	if got := diffs[merchantID.String()].After; got != int64(cli) {
		t.Errorf("endpoint after = %d, CLI = %d; the two rebuild paths must agree", got, cli)
	}
}

func TestRebuildBalancesEndpoint_IncludesMerchantsWithNoBatchesYet(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)
	merchantID := insertActiveMerchant(t, pool)
	insertCaptureEvent(t, pool, merchantID, 4_750, time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC))

	resp := post(t, server, "/internal/rebuild-balances", "Bearer "+testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var diffs map[string]rebuildDiffResponse
	decodeJSON(t, resp, &diffs)

	diff, ok := diffs[merchantID.String()]
	if !ok {
		t.Fatalf("a merchant with ledger activity but no batch yet is missing from the rebuild")
	}
	if diff.After != 4_750 {
		t.Errorf("after = %d, want 4750", diff.After)
	}
}
