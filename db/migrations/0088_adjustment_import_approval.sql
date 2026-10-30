-- Two-person control for adjustment imports (docs/bugs/053).
--
-- An import used to post every row the moment it was uploaded, whatever the
-- total, while a single credit over 50 BD needs a second admin. An import
-- that moves more than that (counted on absolute amounts) is now stored as
-- 'pending_approval' with its rows but no ledger postings, and a different
-- finance or super_admin approves or rejects it.
--
-- Every existing row was applied on upload, so the default keeps them
-- 'applied'. applied_at is now only set once the rows are posted.
ALTER TABLE adjustment_imports
    ADD COLUMN status TEXT NOT NULL DEFAULT 'applied'
        CHECK (status IN ('pending_approval', 'applied', 'rejected')),
    ADD COLUMN total_fils BIGINT,
    ADD COLUMN decided_by_admin_user_id UUID REFERENCES admin_users (id),
    ADD COLUMN decided_at TIMESTAMPTZ,
    ADD COLUMN decision_note TEXT,
    ALTER COLUMN applied_at DROP NOT NULL,
    ALTER COLUMN applied_at DROP DEFAULT;

ALTER TABLE adjustment_imports
    ADD CONSTRAINT adjustment_imports_applied_at_matches_status
        CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
    ADD CONSTRAINT adjustment_imports_decider_differs
        CHECK (decided_by_admin_user_id IS NULL OR decided_by_admin_user_id <> uploaded_by_admin_user_id);

CREATE INDEX idx_adjustment_imports_pending ON adjustment_imports (created_at) WHERE status = 'pending_approval';
