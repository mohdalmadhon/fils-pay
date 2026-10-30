-- platform_stats.total_processed_fils as BIGINT (docs/improvements/05).
--
-- 0049 created it as INTEGER, max 2,147,483,647 fils (about 2,147,483 BD).
-- The volume-tier threshold it is compared with is 2,000,000,000 fils, so
-- the platform could cross the tier and then overflow within ~7 % more
-- volume. Settlement also added each batch in int32, so the total wrapped
-- negative and the tier discount switched off. A comment in the API
-- (platformVolumeTier.ts) said the column was already BIGINT; it wasn't.
-- Widening is lossless for every existing value.

ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
