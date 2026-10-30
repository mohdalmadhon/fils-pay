package settlement

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// failSettlementBatchInsertsFor installs a trigger that makes every
// settlement_batches insert for merchantID fail, so CloseBatch errors for
// that one merchant only. Removed when the test ends.
func failSettlementBatchInsertsFor(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	suffix := strings.ReplaceAll(merchantID.String(), "-", "")
	fn, trg := "test_fail_batch_"+suffix, "test_fail_batch_trg_"+suffix
	_, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION %[1]s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
		  IF NEW.merchant_id = '%[2]s' THEN RAISE EXCEPTION 'test: injected batch failure'; END IF;
		  RETURN NEW;
		END $$;
		CREATE TRIGGER %[3]s BEFORE INSERT ON settlement_batches FOR EACH ROW EXECUTE FUNCTION %[1]s();
	`, fn, merchantID, trg))
	if err != nil {
		t.Fatalf("install failing trigger: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON settlement_batches; DROP FUNCTION IF EXISTS %s();`, trg, fn)) //nolint:errcheck
	})
}

// One merchant whose close fails must not stop the merchants after it.
func TestRunDailyBatch_ContinuesPastAFailingMerchant(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	a, b := insertActiveMerchant(t, pool, mdrBps), insertActiveMerchant(t, pool, mdrBps)
	// RunDailyBatch goes in merchant-id order: make the failing one first.
	bad, good := a, b
	if good.String() < bad.String() {
		bad, good = good, bad
	}
	failSettlementBatchInsertsFor(t, pool, bad)

	businessDate := time.Date(2026, 2, 3, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, good, mdrBps, 10_000, start.Add(time.Hour))

	report, err := RunDailyBatch(context.Background(), pool, businessDate, nil)
	if !errors.Is(err, ErrMerchantsFailed) {
		t.Fatalf("RunDailyBatch err = %v, want one wrapping ErrMerchantsFailed", err)
	}

	var sawBad, sawGood bool
	for _, r := range report.MerchantResults {
		switch r.MerchantID {
		case bad:
			sawBad = true
			if !strings.Contains(r.Error, "injected batch failure") {
				t.Errorf("failing merchant's outcome Error = %q, want the injected failure", r.Error)
			}
		case good:
			sawGood = true
			if r.Error != "" || r.GrossFils != 10_000 {
				t.Errorf("good merchant outcome = %+v, want gross 10000 and no error", r)
			}
		}
	}
	if !sawBad || !sawGood {
		t.Fatalf("report is missing a merchant: sawBad=%v sawGood=%v", sawBad, sawGood)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2 AND status = 'paid'`, good, businessDate); n != 1 {
		t.Errorf("good merchant has %d paid batch(es) for the day, want 1", n)
	}
}
