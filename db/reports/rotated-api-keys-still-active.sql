-- Read-only report: API keys that were "rotated" but still authenticate.
--
-- Until the fix in apps/api/src/apiKeys/issue.ts, rotating a key issued the
-- replacement and never revoked the old one, so every key ever rotated
-- (often because it leaked) still works. This lists each one with when it
-- was replaced and when it was last used.
--
-- last_used_at after replaced_at means the merchant (or whoever holds the
-- old key) is still calling with it. Check with the merchant before revoking
-- those, or they will start getting 401s.
--
-- To revoke them all once you are ready:
--   UPDATE api_keys old SET revoked_at = now(), revoked_reason = 'rotated'
--     FROM api_keys new
--    WHERE new.rotated_from_key_id = old.id AND old.revoked_at IS NULL;
--
--   psql "$DATABASE_URL" -f db/reports/rotated-api-keys-still-active.sql

SELECT old.merchant_id,
       m.display_name,
       old.id            AS old_key_id,
       old.key_prefix    AS old_key_prefix,
       new.id            AS replaced_by_key_id,
       new.created_at    AS replaced_at,
       old.last_used_at,
       old.last_used_at > new.created_at AS used_after_rotation
  FROM api_keys new
  JOIN api_keys old ON old.id = new.rotated_from_key_id
  JOIN merchants m  ON m.id = old.merchant_id
 WHERE old.revoked_at IS NULL
 ORDER BY used_after_rotation DESC NULLS LAST, new.created_at;
