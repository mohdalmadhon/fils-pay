-- Additional suspense accounts for future reconciliation lanes.
--
-- Written against 0007's chart_of_accounts (id, name, kind). An earlier
-- version used code/account_type/description columns that the table has
-- never had, so a fresh `npm run migrate` stopped here. Suspense balances
-- are carried as assets, like scheme_rounding_residue in 0007.
-- ON CONFLICT keeps it safe to apply on databases that skipped it.

INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  ('fx_rounding_difference', 'FX rounding difference (suspense): fils vs scheme-file BD amounts', 'asset'),
  ('chargeback_suspense', 'Chargeback suspense: held pending acquirer confirmation', 'asset')
ON CONFLICT (id) DO NOTHING;
