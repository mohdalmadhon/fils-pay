-- One least-privilege login role per service (docs/improvements/13).
--
-- Until now every service, and the migrate/seed jobs, used the one role that
-- owns the whole database (compose TODO: "give the api its own role before
-- anything is hosted"). A SQL injection or a leaked password in any service
-- meant full control of every table, DDL and TRUNCATE included.
--
-- After this script:
--   owner (whoever runs migrations)  everything, as before; used only by migrate
--   filspay_api         read/write all tables; no DDL; no TRUNCATE except the
--                       two reporting rollups (admin rebuild); ledger_entries
--                       is INSERT-only (append-only, on top of its trigger)
--   filspay_settlement  read all; write only what CloseBatch, payouts, splits,
--                       balances and MDR previews write; ledger INSERT-only
--   filspay_reporting   read the outbox and the few source tables it uses;
--                       write only its rollups and its cursor
--
-- Run it as the database owner after every `npm run migrate` that adds a
-- table (new tables are NOT covered automatically except for the api, see the
-- end). It is idempotent.
--
--   psql "$OWNER_DATABASE_URL" \
--     -v api_password="$API_DB_PASSWORD" \
--     -v settlement_password="$SETTLEMENT_DB_PASSWORD" \
--     -v reporting_password="$REPORTING_DB_PASSWORD" \
--     -f ops/db/service-roles.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspay_api') THEN CREATE ROLE filspay_api LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspay_settlement') THEN CREATE ROLE filspay_settlement LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspay_reporting') THEN CREATE ROLE filspay_reporting LOGIN; END IF;
END $$;

ALTER ROLE filspay_api PASSWORD :'api_password';
ALTER ROLE filspay_settlement PASSWORD :'settlement_password';
ALTER ROLE filspay_reporting PASSWORD :'reporting_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO filspay_api, filspay_settlement, filspay_reporting', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO filspay_api, filspay_settlement, filspay_reporting;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO filspay_api, filspay_settlement, filspay_reporting;

-- api -------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO filspay_api;
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM filspay_api;
REVOKE UPDATE, DELETE ON ledger_entries FROM filspay_api;
GRANT TRUNCATE ON merchant_daily_volume, merchant_payout_trends TO filspay_api; -- admin reporting rebuild

-- settlement --------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO filspay_settlement;
REVOKE SELECT ON schema_migrations FROM filspay_settlement;
GRANT INSERT ON ledger_entries, outbox_events, scheme_export_lines, settlement_batch_splits TO filspay_settlement;
GRANT INSERT, UPDATE ON settlement_batches, merchant_balances TO filspay_settlement;
GRANT UPDATE ON platform_stats, transaction_events, merchants TO filspay_settlement;
-- SELECT ... FOR UPDATE / FOR SHARE needs UPDATE privilege on the locked table.
GRANT UPDATE ON merchant_split_children TO filspay_settlement;

-- reporting ---------------------------------------------------------------
GRANT SELECT ON outbox_events, transactions, transaction_events, settlement_batches TO filspay_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON merchant_daily_volume, merchant_payout_trends, reporting_outbox_cursor
  TO filspay_reporting;
-- Which outbox events each consumer has applied (0081, audit 10 on main):
-- the consumer checks, records and, on a cursor reset, clears them.
GRANT SELECT, INSERT, DELETE ON reporting_processed_events TO filspay_reporting;

-- New tables created later by the owner: the api gets DML by default; give
-- settlement and reporting what they need explicitly, here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO filspay_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO filspay_api, filspay_settlement, filspay_reporting;
