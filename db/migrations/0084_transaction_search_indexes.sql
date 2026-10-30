-- Preserve the current substring/wildcard and exact textual UUID search.
-- All three OR branches need usable indexes; an unindexed id::text branch
-- can otherwise make the planner scan despite the reference indexes.
-- The migration runner wraps files in a transaction, so these builds block
-- writes: apply in a quiet window. No transaction data or search SQL changes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_transactions_reference_trgm ON transactions USING gin (reference gin_trgm_ops);
CREATE INDEX idx_transactions_acquirer_reference_trgm ON transactions USING gin (acquirer_reference gin_trgm_ops);
CREATE INDEX idx_transactions_id_text ON transactions ((id::text));
