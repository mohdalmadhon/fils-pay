-- Read-only report: test merchants that "Recompute transaction statuses"
-- switched to live.
--
-- Until the fix in apps/api/src/routes/adminMerchantsRecompute.ts, that admin
-- tool also cleared merchants.test_mode whenever it counted no open
-- authorizations, and the count was always 0. The settlement service only
-- skips test_mode merchants (apps/settlement/internal/settlement/batch.go),
-- so from that moment the merchant's transactions were batched, charged MDR
-- and paid out like a real merchant's.
--
-- Every such run is in admin_audit_log with metadata.flagsUpdated
-- containing "test_mode". This lists each one, whether the merchant is still
-- live now, and the settlement batches created for it afterwards.
--
-- This changes nothing. To put a merchant back into test mode once you have
-- confirmed it really is a sandbox account:
--   UPDATE merchants SET test_mode = true WHERE id = '<merchant id>';
-- Batches already paid out need finance to reverse them.
--
--   psql "$DATABASE_URL" -f db/reports/test-merchants-made-live-by-recompute.sql

SELECT a.target_id::uuid                 AS merchant_id,
       m.display_name,
       a.created_at                      AS made_live_at,
       au.email                          AS by_admin,
       m.test_mode                       AS test_mode_now,
       count(sb.id)                      AS batches_since,
       count(sb.id) FILTER (WHERE sb.status = 'paid') AS paid_batches_since,
       coalesce(sum(sb.net_payout_fils) FILTER (WHERE sb.status = 'paid'), 0) AS paid_out_fils_since
  FROM admin_audit_log a
  JOIN merchants m    ON m.id = a.target_id::uuid
  JOIN admin_users au ON au.id = a.admin_user_id
  LEFT JOIN settlement_batches sb
         ON sb.merchant_id = m.id
        AND sb.created_at >= a.created_at
 WHERE a.action = 'transaction_status_recompute'
   AND a.metadata -> 'flagsUpdated' ? 'test_mode'
 GROUP BY a.id, a.target_id, m.display_name, a.created_at, au.email, m.test_mode
 ORDER BY a.created_at;
