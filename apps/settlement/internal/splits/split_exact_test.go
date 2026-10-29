package splits

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// Split payouts used to be "always a few fils short": each child's share was
// rounded on its own, so the parts didn't add up to the batch's net payout.

func TestChildSharesAddUpExactly(t *testing.T) {
	weights := []ChildWeight{{3_333}, {3_333}, {3_334}}
	for _, net := range []money.Fils{1_000, 1_001, 999, 2, 471_300, 1_234_567} {
		var sum money.Fils
		for _, s := range ChildShares(net, weights) {
			sum += s
		}
		if sum != net {
			t.Errorf("shares of %d sum to %d", net, sum)
		}
	}
	// The case that used to come out short: 333 + 333 + 333 = 999.
	if got := ChildShares(1_000, weights); got[0]+got[1]+got[2] != 1_000 {
		t.Fatalf("1000 over 3333/3333/3334 = %v", got)
	}
}

func TestChildSharesNothingToSplit(t *testing.T) {
	for _, net := range []money.Fils{0, -500} {
		for _, s := range ChildShares(net, []ChildWeight{{5_000}, {5_000}}) {
			if s != 0 {
				t.Fatalf("net %d produced a non-zero share %d", net, s)
			}
		}
	}
}

func TestChildSharesWeightsNotSummingTo10000AreProportions(t *testing.T) {
	got := ChildShares(900, []ChildWeight{{3_000}, {6_000}})
	if got[0] != 300 || got[1] != 600 {
		t.Fatalf("got %v, want [300 600]: the whole payout must go out", got)
	}
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newMerchant(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO merchants (display_name, mdr_bps, status) VALUES ($1, 250, 'active') RETURNING id`,
		"Split Exact "+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPayoutSplitBatchPaysOutTheWholeNet(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	parent := newMerchant(t, pool)
	for _, w := range []int{3_333, 3_333, 3_334} {
		child := newMerchant(t, pool)
		if _, err := pool.Exec(ctx,
			`INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, $3)`,
			parent, child, w); err != nil {
			t.Fatal(err)
		}
	}
	const net = 1_000 // 333 + 333 + 333 = 999 under the old rounding
	// The parent needs the net in merchant_payable, as CloseBatch would have left it.
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, 'card_scheme_clearing', 'debit', $3, now(), 'test: seed payable'),
		       ($1, $2, 'merchant_payable', 'credit', $3, now(), 'test: seed payable')`,
		uuid.New(), parent, net); err != nil {
		t.Fatal(err)
	}
	var batchID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, $2, 'closed', $3, 0, $3, now()) RETURNING id`,
		parent, time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC), net).Scan(&batchID); err != nil {
		t.Fatal(err)
	}

	res, err := PayoutSplitBatch(ctx, pool, batchID)
	if err != nil {
		t.Fatalf("PayoutSplitBatch: %v", err)
	}
	var total money.Fils
	for _, s := range res.Shares {
		total += s.AllocatedFils
	}
	if total != net {
		t.Fatalf("shares sum to %d, want the batch's net %d", total, net)
	}

	var recorded, debited int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(allocated_fils), 0) FROM settlement_batch_splits WHERE settlement_batch_id = $1`, batchID).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries
		 WHERE settlement_batch_id = $1 AND account_id = 'merchant_payable' AND direction = 'debit'`, batchID).Scan(&debited); err != nil {
		t.Fatal(err)
	}
	if recorded != net || debited != net {
		t.Fatalf("recorded %d and debited %d fils, want %d both", recorded, debited, net)
	}
}
