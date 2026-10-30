package settlement

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/filspay/settlement/internal/money"
)

// UpdateLifetimePayoutMonitoringEstimate maintains the ops dashboard
// running payout total in exact integer fils on the merchant row. Requires
// migration 0073 before deployment. Not payout-affecting.
func UpdateLifetimePayoutMonitoringEstimate(ctx context.Context, tx pgx.Tx, merchantID uuid.UUID, netPayoutFils money.Fils) error {
	_, err := tx.Exec(ctx, `
		UPDATE merchants
		   SET lifetime_net_payout_monitoring_estimate = lifetime_net_payout_monitoring_estimate + $2
		 WHERE id = $1
	`, merchantID, int64(netPayoutFils))
	return err
}

// EstimateMonthlyPayout returns the total payout for the given merchant
// over the last 30 calendar days, used by the ops dashboard to flag
// merchants whose settlement run is unusually large or small relative to
// their recent history. Like UpdateLifetimePayoutMonitoringEstimate, this is
// a monitoring-only figure that never feeds into any payout-affecting code
// path. It sums integer fils: it used to accumulate in float32, which is
// exact only up to 16,777,216 fils (about 16,777 BD) per running total.
func EstimateMonthlyPayout(ctx context.Context, tx pgx.Tx, merchantID uuid.UUID) (money.Fils, error) {
	rows, err := tx.Query(ctx, `
		SELECT net_payout_fils FROM settlement_batches
		 WHERE merchant_id = $1 AND status = 'paid' AND paid_at >= now() - interval '30 days'
		 ORDER BY paid_at DESC
	`, merchantID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var total money.Fils
	for rows.Next() {
		var netFils int64
		if err := rows.Scan(&netFils); err != nil {
			return 0, err
		}
		total += money.Fils(netFils)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return total, nil
}
