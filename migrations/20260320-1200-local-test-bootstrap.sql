-- Purpose: Reset and initialize the local D1 database for manual testing
-- Scope: Local development only
-- Rollback: Re-run this file to reset local test data

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS Expenses;
DROP TABLE IF EXISTS LoginAttempts;
DROP TABLE IF EXISTS OrderOverpaymentIssues;
DROP TABLE IF EXISTS OrderBoothChanges;
DROP TABLE IF EXISTS ProjectErpConfigs;
DROP TABLE IF EXISTS ProjectOrderFieldSettings;
DROP TABLE IF EXISTS Payments;
DROP TABLE IF EXISTS Orders;
DROP TABLE IF EXISTS Booths;
DROP TABLE IF EXISTS Prices;
DROP TABLE IF EXISTS Industries;
DROP TABLE IF EXISTS Accounts;
DROP TABLE IF EXISTS Staff;
DROP TABLE IF EXISTS Projects;

CREATE TABLE Projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  year INTEGER,
  start_date TEXT,
  end_date TEXT
);

CREATE TABLE Staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  target REAL NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  exclude_from_sales_ranking INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE Accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  bank_name TEXT,
  account_no TEXT
);

CREATE TABLE Industries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  industry_name TEXT NOT NULL,
  UNIQUE(project_id, industry_name)
);

CREATE TABLE Prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  booth_type TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  UNIQUE(project_id, booth_type)
);

CREATE TABLE Booths (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  hall TEXT NOT NULL,
  type TEXT NOT NULL,
  area REAL NOT NULL DEFAULT 0,
  price_unit TEXT,
  base_price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '可售',
  UNIQUE(id, project_id)
);

CREATE TABLE Orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  credit_code TEXT,
  no_code_checked INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  main_business TEXT,
  is_agent INTEGER NOT NULL DEFAULT 0,
  agent_name TEXT,
  contact_person TEXT NOT NULL,
  phone TEXT NOT NULL,
  region TEXT,
  booth_id TEXT NOT NULL,
  area REAL NOT NULL DEFAULT 0,
  price_unit TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  total_booth_fee REAL NOT NULL DEFAULT 0,
  discount_reason TEXT,
  other_income REAL NOT NULL DEFAULT 0,
  fees_json TEXT NOT NULL DEFAULT '[]',
  profile TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  contract_url TEXT,
  sales_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '正常',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE Payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  payment_time TEXT NOT NULL,
  payer_name TEXT,
  bank_name TEXT,
  remarks TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  erp_record_id TEXT,
  raw_payload TEXT,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE UNIQUE INDEX idx_payments_erp_record_id ON Payments (erp_record_id);

CREATE TABLE LoginAttempts (
  attempt_key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TEXT,
  locked_until TEXT
);

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

CREATE TABLE ProjectOrderFieldSettings (
  project_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  PRIMARY KEY (project_id, field_key)
);

CREATE TABLE Expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  payee_name TEXT NOT NULL,
  payee_channel TEXT,
  payee_bank TEXT,
  payee_account TEXT,
  amount REAL NOT NULL DEFAULT 0,
  applicant TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE TABLE OrderOverpaymentIssues (
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

CREATE TABLE OrderBoothChanges (
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

INSERT INTO Projects (id, name, year, start_date, end_date) VALUES
  (1, 'Local Demo Expo 2026', 2026, '2026-05-18', '2026-05-20');

INSERT INTO Staff (name, password, role, target, display_order) VALUES
  ('admin', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'admin', 12, 0),
  ('sales01', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'user', 8, 1);

INSERT INTO Accounts (project_id, account_name, bank_name, account_no) VALUES
  (1, 'Demo Company', 'ICBC', '6222000000000001'),
  (1, 'WeChat Collection', 'WeChat', '');

INSERT INTO Industries (project_id, industry_name) VALUES
  (1, 'Aquatic Products'),
  (1, 'Cold Chain Equipment'),
  (1, 'Marine Technology');

INSERT INTO Prices (project_id, booth_type, price) VALUES
  (1, '标摊', 9800),
  (1, '豪标', 12800),
  (1, '光地', 1000);

INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES
  ('1A01', 1, '1号馆', '标摊', 9, '个', 0, '可售'),
  ('1A02', 1, '1号馆', '标摊', 9, '个', 0, '可售'),
  ('1B01', 1, '1号馆', '豪标', 9, '个', 0, '可售'),
  ('2C01', 1, '2号馆', '光地', 36, '平米', 0, '可售');

PRAGMA foreign_keys = ON;
