-- Redact stored authorize request hashes (docs/cyper/10-card-data-in-idempotency-hash.md).
--
-- Until this change, idempotency_keys.request_hash for transactions.authorize
-- was an unsalted sha256 over the whole request body, including the full card
-- number and CVV. The API now stores a fingerprint without them, but rows
-- written before that still hold the old hashes, and those can be
-- brute-forced back to the card offline.
--
-- The old hashes can't be recomputed into the new form (that would need the
-- card), so they are overwritten with a marker that never equals a real hash.
-- Effect: re-sending one of these old, finished requests with the same
-- Idempotency-Key answers 422 idempotency_key_reused instead of replaying the
-- stored result. The stored response, status and resource id are kept.
-- Rows still in progress are left alone so a request running during the
-- deploy can finish.

UPDATE idempotency_keys
   SET request_hash = 'redacted:0079'
 WHERE endpoint = 'transactions.authorize'
   AND status <> 'in_progress'
   AND request_hash <> 'redacted:0079';
