-- Purpose: Track ERP-driven overpayment anomalies for order follow-up
-- Scope: Production and local environments
-- Rollback: DROP TABLE OrderOverpaymentIssues;

CREATE TABLE IF NOT EXISTS OrderOverpaymentIssues (
  order_id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  overpaid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  note TEXT,
  handled_by TEXT,
  handled_at TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
