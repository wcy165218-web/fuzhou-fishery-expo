-- Purpose: Add ERP payment sync support for production D1
-- Run once in Cloudflare D1 console or with wrangler d1 execute

CREATE TABLE ProjectErpConfigs (
  project_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  endpoint_url TEXT,
  water_id TEXT,
  session_cookie TEXT,
  expected_project_name TEXT,
  use_mock INTEGER NOT NULL DEFAULT 0,
  mock_payload TEXT,
  last_sync_at TEXT,
  last_sync_summary TEXT
);

ALTER TABLE Payments ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE Payments ADD COLUMN erp_record_id TEXT;
ALTER TABLE Payments ADD COLUMN raw_payload TEXT;

CREATE UNIQUE INDEX idx_payments_erp_record_id ON Payments (erp_record_id);
