package ledger

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RefreshBalanceCache backs the admin balance rebuild. Use the CLI's ledger
// recompute so both paths restore the same outstanding merchant liability,
// rather than replacing it with gross scheme-export volume (ADR 0007).
func RefreshBalanceCache(ctx context.Context, db *pgxpool.Pool) (map[uuid.UUID]RebuildDiff, error) {
	return RebuildAllBalances(ctx, db)
}
