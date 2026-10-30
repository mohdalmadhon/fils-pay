-- Registrations may be removed; delivery bodies and archives remain audit data.
ALTER TABLE webhook_deliveries ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_endpoint_id_fkey;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey
  FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE SET NULL;
ALTER TABLE webhook_delivery_archives ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_delivery_archives DROP CONSTRAINT webhook_delivery_archives_endpoint_id_fkey;
ALTER TABLE webhook_delivery_archives ADD CONSTRAINT webhook_delivery_archives_endpoint_id_fkey
  FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE SET NULL;
