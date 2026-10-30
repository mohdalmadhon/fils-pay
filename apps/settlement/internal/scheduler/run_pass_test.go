package scheduler

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mustPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertMerchant(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, 250, 'active', false) RETURNING id
	`, "scheduler-run-pass-test-"+uuid.New().String()).Scan(&id)
	if err != nil {
		t.Fatalf("insert merchant: %v", err)
	}
	return id
}

// A merchant whose batch fails must not stop the payout notification scan:
// other merchants were paid and their merchants still need to be told.
func TestRunPass_EnqueuesNotificationsEvenWhenAMerchantFails(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	bad := insertMerchant(t, pool)
	suffix := strings.ReplaceAll(bad.String(), "-", "")
	fn, trg := "test_fail_batch_"+suffix, "test_fail_batch_trg_"+suffix
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION %[1]s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
		  IF NEW.merchant_id = '%[2]s' THEN RAISE EXCEPTION 'test: injected batch failure'; END IF;
		  RETURN NEW;
		END $$;
		CREATE TRIGGER %[3]s BEFORE INSERT ON settlement_batches FOR EACH ROW EXECUTE FUNCTION %[1]s();
	`, fn, bad, trg)); err != nil {
		t.Fatalf("install failing trigger: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON settlement_batches; DROP FUNCTION IF EXISTS %s();`, trg, fn)) //nolint:errcheck
	})

	// Another merchant has a paid batch that has not been announced yet.
	paidMerchant := insertMerchant(t, pool)
	var paidBatchID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
		VALUES ($1, '2026-02-01', 'paid', 10000, 250, 9750, now(), now()) RETURNING id
	`, paidMerchant).Scan(&paidBatchID); err != nil {
		t.Fatalf("insert paid batch: %v", err)
	}

	runPass(ctx, pool, time.Date(2026, 2, 4, 0, 0, 0, 0, time.UTC))

	var n int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1
	`, paidBatchID).Scan(&n); err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	if n != 1 {
		t.Errorf("settlement.paid events for the paid batch = %d, want 1", n)
	}
}
