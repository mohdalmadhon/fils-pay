-- A cumulative FILS counter exceeds INT4 after only 2,147,483.647 BD.
-- Plan: widen before deploying the int64 worker; no historical value is guessed.
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
-- Existing wrapped counters require finance review against closed batches.
