// Package ledger rebuilds merchant_balances from ledger_entries. Nothing
// automatic calls this — the incremental path is in internal/balances.
// This is for the manual `rebuild-balances` CLI subcommand.
package ledger

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// RebuildMerchantBalance recomputes merchantID's cached balance from
// ledger_entries. CLI-only; the incremental path is in internal/balances.
func RebuildMerchantBalance(ctx context.Context, db *pgxpool.Pool, merchantID uuid.UUID) (money.Fils, error) {
	var balance int64
	err := db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries
		 WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): %w", merchantID, err)
	}
	return money.Fils(balance), nil
}

// RebuildDiff is the before/after state for one merchant, printed by the
// rebuild-balances CLI subcommand so an operator sees exactly what
// changed.
//
// Changed reports drift against the ledger: a false result means the cache
// already matched ledger_entries for that merchant.
type RebuildDiff struct {
	MerchantID   uuid.UUID
	CachedBefore money.Fils
	Rebuilt      money.Fils
}

// Changed reports whether the cached value differed from the rebuilt,
// authoritative one.
func (d RebuildDiff) Changed() bool {
	return d.CachedBefore != d.Rebuilt
}

// RebuildAllBalances recomputes every merchant's cached balance from
// ledger_entries (the authoritative record) and overwrites merchant_balances
// in one transaction. It returns the full before/after map so callers can
// show exactly what changed.
//
// This is the only full-recompute path. Both `settlement rebuild-balances`
// (the CLI) and POST /internal/rebuild-balances (the admin console's
// "Rebuild cached balances" button) call it, so the two can never disagree
// about a merchant's balance.
//
// Concurrency: merchant_balances is locked before the ledger is read.
// CloseBatch, PayoutBatch, credits and imports all update the cache in the
// same transaction as their own writes, so while this lock is held they wait
// at their cache update. If one of them committed before the lock, its ledger
// legs are visible to the read below; if it is still in flight, its legs are
// not visible yet and its cache delta lands on top of the rebuilt value once
// this transaction commits. Either way no delta is lost.
func RebuildAllBalances(ctx context.Context, db *pgxpool.Pool) (map[uuid.UUID]RebuildDiff, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// SHARE ROW EXCLUSIVE blocks every INSERT/UPDATE on the cache (including
	// the upserts that create a first row for a new merchant) until commit,
	// while still allowing reads, so the dashboard keeps working meanwhile.
	if _, err := tx.Exec(ctx, `LOCK TABLE merchant_balances IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: lock merchant_balances: %w", err)
	}

	// One pass over the ledger for every merchant, rather than two queries per
	// merchant. Merchants that only exist in the cache (no ledger activity)
	// are rebuilt to zero.
	rows, err := tx.Query(ctx, `
		WITH ledger AS (
			SELECT merchant_id,
			       SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) AS balance
			  FROM ledger_entries
			 WHERE account_id = 'merchant_payable'
			 GROUP BY merchant_id
		)
		SELECT COALESCE(l.merchant_id, mb.merchant_id) AS merchant_id,
		       COALESCE(mb.cached_payable_fils, 0)      AS cached_before,
		       COALESCE(l.balance, 0)::bigint           AS rebuilt
		  FROM ledger l
		  FULL OUTER JOIN merchant_balances mb ON mb.merchant_id = l.merchant_id
	`)
	if err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: recompute balances: %w", err)
	}

	diffs := make(map[uuid.UUID]RebuildDiff)
	var ids []uuid.UUID
	var balances []int64
	for rows.Next() {
		var id uuid.UUID
		var before, rebuilt int64
		if err := rows.Scan(&id, &before, &rebuilt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("ledger: RebuildAllBalances: scan: %w", err)
		}
		diffs[id] = RebuildDiff{MerchantID: id, CachedBefore: money.Fils(before), Rebuilt: money.Fils(rebuilt)}
		ids = append(ids, id)
		balances = append(balances, rebuilt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: iterate: %w", err)
	}
	rows.Close()

	if len(ids) > 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
			SELECT id, balance, now() FROM unnest($1::uuid[], $2::bigint[]) AS r(id, balance)
			ON CONFLICT (merchant_id) DO UPDATE
			  SET cached_payable_fils = EXCLUDED.cached_payable_fils, updated_at = now()
		`, ids, balances)
		if err != nil {
			return nil, fmt.Errorf("ledger: RebuildAllBalances: write rebuilt balances: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: commit: %w", err)
	}
	return diffs, nil
}
