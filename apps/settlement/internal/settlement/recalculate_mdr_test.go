package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// recalcWindow returns the half-open [from, to) range covering exactly the
// one business date a test closed its batch on.
func recalcWindow(businessDate time.Time) (time.Time, time.Time) {
	return businessDate, businessDate.AddDate(0, 0, 1)
}

// These tests describe ADR 0008 (docs/adr/0008-mdr-finalized-batches.md):
// RecalculateMDR refreshes provisional totals of OPEN batches only, from the
// captures CloseBatch would claim, and never touches closed or paid batches
// or posts ledger entries. The four tests that used to be here asserted the
// old behaviour (rewrite closed batches, post an adjustment group), which the
// ADR replaced on 2026-10-29; they were left failing on purpose at the time.

// insertOpenBatch creates an open batch row with the given provisional totals.
func insertOpenBatch(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, businessDate time.Time, gross, fee money.Fils) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils)
		VALUES ($1, $2, 'open', $3, $4, $5)
		RETURNING id
	`, merchantID, businessDate, int64(gross), int64(fee), int64(NetPayableFils(gross, fee))).Scan(&id)
	if err != nil {
		t.Fatalf("insertOpenBatch: %v", err)
	}
	return id
}

// currentTierBonusBps reads the platform volume tier the same way
// RecalculateMDR does, so expected fees match whatever volume the shared
// test database has accumulated.
func currentTierBonusBps(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	processed, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("read platform volume: %v", err)
	}
	return VolumeTierMdrBonusBps(processed)
}

func feeAt(amount money.Fils, mdrBps, tierBonusBps int64) money.Fils {
	rate := mdrBps - tierBonusBps
	if rate < 0 {
		rate = 0
	}
	return ComputeSettlementFee(amount, rate, 0)
}

func countRecalcLedgerLegs(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM ledger_entries
		 WHERE merchant_id = $1 AND description = 'MDR recalculation adjustment'
	`, merchantID).Scan(&n); err != nil {
		t.Fatalf("count adjustment legs: %v", err)
	}
	return n
}

func TestRecalculateMDR_RefreshesOpenBatchAtCurrentRate(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const originalMdrBps, newMdrBps = 250, 300
	merchantID := insertActiveMerchant(t, pool, originalMdrBps)

	businessDate := time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	// Three events, so per-event fees must be summed (the amounts make that
	// differ from rating the total).
	amounts := []money.Fils{4750, 1333, 999}
	for i, a := range amounts {
		insertCaptureEvent(t, pool, merchantID, originalMdrBps, a, start.Add(time.Duration(i+1)*time.Hour))
	}
	tier := currentTierBonusBps(t, pool)
	var gross, oldFee, wantFee money.Fils
	for _, a := range amounts {
		gross += a
		oldFee += feeAt(a, originalMdrBps, tier)
		wantFee += feeAt(a, newMdrBps, tier)
	}
	batchID := insertOpenBatch(t, pool, merchantID, businessDate, gross, oldFee)

	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = $2 WHERE id = $1`, merchantID, newMdrBps); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}
	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if result.BatchesConsidered != 1 || len(result.Adjusted) != 1 {
		t.Fatalf("considered %d, adjusted %d; want 1, 1", result.BatchesConsidered, len(result.Adjusted))
	}
	adj := result.Adjusted[0]
	if adj.BatchID != batchID || adj.OldFeeFils != oldFee || adj.NewFeeFils != wantFee || adj.DiffFils != wantFee-oldFee {
		t.Errorf("adjustment = %+v, want batch %s old %d new %d", adj, batchID, oldFee, wantFee)
	}

	var gotGross, gotFee, gotNet int64
	var status string
	if err := pool.QueryRow(ctx, `SELECT status, gross_fils, fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, batchID).
		Scan(&status, &gotGross, &gotFee, &gotNet); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if status != "open" || gotGross != int64(gross) || gotFee != int64(wantFee) || gotNet != int64(NetPayableFils(gross, wantFee)) {
		t.Errorf("batch = %s %d/%d/%d, want open %d/%d/%d", status, gotGross, gotFee, gotNet, gross, wantFee, NetPayableFils(gross, wantFee))
	}
	if n := countRecalcLedgerLegs(t, pool, merchantID); n != 0 {
		t.Errorf("posted %d ledger legs; a preview posts none", n)
	}
}

func TestRecalculateMDR_LeavesClosedAndPaidBatchesAlone(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 200)

	closedDate := time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC)
	paidDate := time.Date(2026, 4, 4, 0, 0, 0, 0, time.UTC)
	for _, d := range []time.Time{closedDate, paidDate} {
		start, _ := BusinessDayWindow(d)
		insertCaptureEvent(t, pool, merchantID, 200, 20_000, start.Add(time.Hour))
	}
	closed, err := CloseBatch(ctx, pool, merchantID, closedDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	paid, err := CloseBatch(ctx, pool, merchantID, paidDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE settlement_batches SET status = 'paid' WHERE id = $1`, paid.BatchID); err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 275 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}

	result, err := RecalculateMDR(ctx, pool, merchantID, closedDate, paidDate.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if result.BatchesConsidered != 0 || len(result.Adjusted) != 0 {
		t.Errorf("considered %d, adjusted %d; finalized batches must not be selected", result.BatchesConsidered, len(result.Adjusted))
	}
	for _, b := range []BatchResult{closed, paid} {
		var fee int64
		if err := pool.QueryRow(ctx, `SELECT fee_fils FROM settlement_batches WHERE id = $1`, b.BatchID).Scan(&fee); err != nil {
			t.Fatalf("read batch: %v", err)
		}
		if fee != int64(b.FeeFils) {
			t.Errorf("batch %s fee_fils = %d, want %d (unchanged)", b.BatchID, fee, b.FeeFils)
		}
	}
	if n := countRecalcLedgerLegs(t, pool, merchantID); n != 0 {
		t.Errorf("posted %d ledger legs, want 0", n)
	}
}

func TestRecalculateMDR_UnchangedRateAdjustsNothing(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 7_500, start.Add(time.Hour))
	tier := currentTierBonusBps(t, pool)
	insertOpenBatch(t, pool, merchantID, businessDate, 7_500, feeAt(7_500, mdrBps, tier))

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if result.BatchesConsidered != 1 {
		t.Errorf("BatchesConsidered = %d, want 1", result.BatchesConsidered)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("len(Adjusted) = %d, want 0 (an unchanged rate is a no-op)", len(result.Adjusted))
	}
}

func TestRecalculateMDR_OutOfRangeBatchUntouched(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const originalMdrBps = 250
	merchantID := insertActiveMerchant(t, pool, originalMdrBps)

	inRangeDate := time.Date(2026, 4, 7, 0, 0, 0, 0, time.UTC)
	outOfRangeDate := time.Date(2026, 4, 9, 0, 0, 0, 0, time.UTC)
	tier := currentTierBonusBps(t, pool)
	for _, d := range []time.Time{inRangeDate, outOfRangeDate} {
		start, _ := BusinessDayWindow(d)
		insertCaptureEvent(t, pool, merchantID, originalMdrBps, 6_000, start.Add(time.Hour))
	}
	insertOpenBatch(t, pool, merchantID, inRangeDate, 6_000, feeAt(6_000, originalMdrBps, tier))
	outID := insertOpenBatch(t, pool, merchantID, outOfRangeDate, 6_000, feeAt(6_000, originalMdrBps, tier))

	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 400 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}
	from, to := recalcWindow(inRangeDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if result.BatchesConsidered != 1 || len(result.Adjusted) != 1 {
		t.Errorf("considered %d, adjusted %d; want 1, 1", result.BatchesConsidered, len(result.Adjusted))
	}
	var gotFee int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils FROM settlement_batches WHERE id = $1`, outID).Scan(&gotFee); err != nil {
		t.Fatalf("read out-of-range batch: %v", err)
	}
	if gotFee != int64(feeAt(6_000, originalMdrBps, tier)) {
		t.Errorf("out-of-range batch fee_fils = %d, want unchanged %d", gotFee, feeAt(6_000, originalMdrBps, tier))
	}
}

// compile-time assertion that RecalculateMDR keeps the *pgxpool.Pool
// signature the internal API handler passes it.
var _ func(context.Context, *pgxpool.Pool, uuid.UUID, time.Time, time.Time) (RecalcResult, error) = RecalculateMDR
