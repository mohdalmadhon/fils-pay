-- GET /v1/analytics/breakdown (apps/api/src/analytics/query.ts getBreakdown)
-- filters transactions on (merchant_id, created_at), but the only per-merchant
-- index is (merchant_id, occurred_at DESC, id DESC) from 0017, which can't
-- serve a created_at range. Postgres fell back to a sequential scan of the
-- whole transactions table, every merchant's rows, on each dashboard load,
-- so it got slower as the platform grew, not as the merchant did.
-- Measured on 300k rows: 31 ms seq scan -> 1.2 ms index scan.
-- IF NOT EXISTS so it can be built CONCURRENTLY by hand first on a big table.

CREATE INDEX IF NOT EXISTS idx_transactions_merchant_created ON transactions (merchant_id, created_at);
