-- Purpose: Add staff ordering and per-project order field settings
-- Scope: Production and local D1
-- Rollback: Manual rollback only

ALTER TABLE Staff ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

UPDATE Staff
SET display_order = id
WHERE display_order IS NULL OR display_order = 0;

CREATE TABLE IF NOT EXISTS ProjectOrderFieldSettings (
  project_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  PRIMARY KEY (project_id, field_key)
);
