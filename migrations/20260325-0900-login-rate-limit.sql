-- Purpose: Add login attempt tracking for temporary lockout after repeated failures
-- Scope: Production / remote D1
-- Rollback: DROP TABLE LoginAttempts;

CREATE TABLE IF NOT EXISTS LoginAttempts (
  attempt_key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TEXT,
  locked_until TEXT
);
