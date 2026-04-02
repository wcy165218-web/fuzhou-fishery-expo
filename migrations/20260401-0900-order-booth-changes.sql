-- Purpose: Track booth replacement operations for statistics and audit
-- Scope: Local and remote D1
-- Rollback: DROP TABLE OrderBoothChanges;

CREATE TABLE IF NOT EXISTS OrderBoothChanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  old_booth_id TEXT NOT NULL,
  new_booth_id TEXT NOT NULL,
  old_area REAL NOT NULL DEFAULT 0,
  new_area REAL NOT NULL DEFAULT 0,
  booth_delta_count REAL NOT NULL DEFAULT 0,
  old_total_amount REAL NOT NULL DEFAULT 0,
  new_total_amount REAL NOT NULL DEFAULT 0,
  total_amount_delta REAL NOT NULL DEFAULT 0,
  changed_by TEXT,
  reason TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
