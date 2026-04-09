CREATE TABLE IF NOT EXISTS BoothLocks (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  booth_id TEXT NOT NULL,
  lock_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, booth_id)
);

CREATE INDEX IF NOT EXISTS idx_booth_locks_project_expires_at
ON BoothLocks (project_id, expires_at);
