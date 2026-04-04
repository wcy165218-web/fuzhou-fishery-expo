-- Purpose: Add token versioning for immediate JWT invalidation
-- Scope: Production / remote D1
-- Rollback: Manual rollback only

ALTER TABLE Staff ADD COLUMN token_index INTEGER NOT NULL DEFAULT 0;
