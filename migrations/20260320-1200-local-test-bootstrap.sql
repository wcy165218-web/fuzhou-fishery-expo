-- Purpose: Reset and initialize the local D1 database for manual testing
-- Scope: Local development only
-- Rollback: Re-run this file to reset local test data

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS Expenses;
DROP TABLE IF EXISTS LoginAttempts;
DROP TABLE IF EXISTS OrderOverpaymentIssues;
DROP TABLE IF EXISTS OrderBoothChanges;
DROP TABLE IF EXISTS BoothMapItems;
DROP TABLE IF EXISTS BoothMaps;
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
  exclude_from_sales_ranking INTEGER NOT NULL DEFAULT 0,
  token_index INTEGER NOT NULL DEFAULT 0
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
  width_m REAL NOT NULL DEFAULT 0,
  height_m REAL NOT NULL DEFAULT 0,
  opening_type TEXT,
  booth_map_id INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
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
  booth_display_name TEXT,
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

CREATE TABLE BoothMaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  background_image_key TEXT,
  scale_pixels_per_meter REAL NOT NULL DEFAULT 0,
  default_stroke_width REAL NOT NULL DEFAULT 2,
  canvas_width REAL NOT NULL DEFAULT 1600,
  canvas_height REAL NOT NULL DEFAULT 900,
  viewport_x REAL NOT NULL DEFAULT 0,
  viewport_y REAL NOT NULL DEFAULT 0,
  viewport_zoom REAL NOT NULL DEFAULT 1,
  calibration_json TEXT NOT NULL DEFAULT '{}',
  display_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE BoothMapItems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  map_id INTEGER NOT NULL,
  booth_code TEXT NOT NULL,
  hall TEXT NOT NULL,
  booth_type TEXT NOT NULL,
  opening_type TEXT,
  width_m REAL NOT NULL DEFAULT 0,
  height_m REAL NOT NULL DEFAULT 0,
  area REAL NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  rotation REAL NOT NULL DEFAULT 0,
  stroke_width REAL NOT NULL DEFAULT 2,
  shape_type TEXT NOT NULL DEFAULT 'rect',
  points_json TEXT NOT NULL DEFAULT '[]',
  label_style_json TEXT NOT NULL DEFAULT '{}',
  z_index INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(project_id, booth_code)
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

INSERT INTO BoothMaps (
  id, project_id, name, background_image_key, scale_pixels_per_meter, default_stroke_width,
  canvas_width, canvas_height, viewport_x, viewport_y, viewport_zoom,
  calibration_json, display_config_json, created_at, updated_at
) VALUES (
  1, 1, '1号馆主图', NULL, 42.5, 2.5,
  1600, 900, 80, 60, 1,
  '{"start":{"x":120,"y":120},"end":{"x":247.5,"y":120},"meters":3}',
  '{"standard":{"boothNo":{"anchorX":0.5,"anchorY":0.2,"fontSize":18,"visible":true},"company":{"anchorX":0.5,"anchorY":0.6,"fontSize":14,"visible":true}},"ground":{"boothNo":{"anchorX":0.5,"anchorY":0.18,"fontSize":20,"visible":true},"company":{"anchorX":0.5,"anchorY":0.58,"fontSize":16,"visible":true},"size":{"anchorX":0.84,"anchorY":0.13,"fontSize":13,"visible":true}}}',
  datetime('now', '+8 hours'), datetime('now', '+8 hours')
);

INSERT INTO Booths (
  id, project_id, hall, type, area, price_unit, base_price, status,
  width_m, height_m, opening_type, booth_map_id, source
) VALUES
  ('1A01', 1, '1号馆', '标摊', 9, '个', 0, '已预订', 3, 3, '单开口', 1, 'map'),
  ('1A02', 1, '1号馆', '标摊', 9, '个', 0, '已预订', 3, 3, '双开口', 1, 'map'),
  ('1B01', 1, '1号馆', '豪标', 9, '个', 0, '可售', 3, 3, '三开口', 1, 'map'),
  ('2C01', 1, '2号馆', '光地', 36, '平米', 0, '已成交', 6, 6, NULL, 1, 'map');

INSERT INTO BoothMapItems (
  project_id, map_id, booth_code, hall, booth_type, opening_type,
  width_m, height_m, area, x, y, rotation, stroke_width,
  shape_type, points_json, label_style_json, z_index, hidden, created_at, updated_at
) VALUES
  (
    1, 1, '1A01', '1号馆', '标摊', '单开口',
    3, 3, 9, 240, 180, 0, 2,
    'rect', '[]',
    '{"boothNo":{"anchorX":0.5,"anchorY":0.2,"fontSize":18,"rotation":0,"visible":true},"company":{"anchorX":0.5,"anchorY":0.6,"fontSize":14,"rotation":0,"visible":true}}',
    1, 0, datetime('now', '+8 hours'), datetime('now', '+8 hours')
  ),
  (
    1, 1, '1A02', '1号馆', '标摊', '双开口',
    3, 3, 9, 390, 180, 0, 2,
    'rect', '[]',
    '{"boothNo":{"anchorX":0.5,"anchorY":0.2,"fontSize":18,"rotation":0,"visible":true},"company":{"anchorX":0.5,"anchorY":0.6,"fontSize":14,"rotation":0,"visible":true}}',
    2, 0, datetime('now', '+8 hours'), datetime('now', '+8 hours')
  ),
  (
    1, 1, '1B01', '1号馆', '豪标', '三开口',
    3, 3, 9, 540, 180, 0, 2,
    'rect', '[]',
    '{"boothNo":{"anchorX":0.5,"anchorY":0.2,"fontSize":18,"rotation":0,"visible":true},"company":{"anchorX":0.5,"anchorY":0.6,"fontSize":14,"rotation":0,"visible":true}}',
    3, 0, datetime('now', '+8 hours'), datetime('now', '+8 hours')
  ),
  (
    1, 1, '2C01', '2号馆', '光地', NULL,
    6, 6, 36, 240, 380, 0, 3,
    'rect', '[]',
    '{"boothNo":{"anchorX":0.5,"anchorY":0.2,"fontSize":20,"rotation":0,"visible":true},"company":{"anchorX":0.5,"anchorY":0.58,"fontSize":16,"rotation":0,"visible":true}}',
    4, 0, datetime('now', '+8 hours'), datetime('now', '+8 hours')
  );

INSERT INTO Orders (
  id, project_id, company_name, credit_code, no_code_checked, category, main_business,
  is_agent, agent_name, contact_person, phone, region, booth_id, area, price_unit,
  unit_price, total_booth_fee, discount_reason, other_income, fees_json, profile,
  total_amount, paid_amount, contract_url, booth_display_name, sales_name, status, created_at
) VALUES
  (
    1, 1, '海渔集团', '91350000DEMO00001', 0, 'Aquatic Products', '海洋食品加工',
    0, '', '陈经理', '13800000001', '福建省 - 福州市 - 鼓楼区', '1A01', 9, '个',
    9800, 9800, '', 0, '[]', '海洋食品企业',
    9800, 3000, NULL, '海渔集团', 'admin', '正常', datetime('now', '+8 hours')
  ),
  (
    2, 1, '远洋设备', '91350000DEMO00002', 0, 'Cold Chain Equipment', '冷链设备',
    0, '', '林总', '13800000002', '浙江 - 宁波', '1A02', 9, '个',
    9800, 9800, '', 0, '[]', '冷链设备企业',
    9800, 0, NULL, '远洋设备', 'admin', '正常', datetime('now', '+8 hours')
  ),
  (
    3, 1, '蓝海广场', '91350000DEMO00003', 0, 'Marine Technology', '数字渔业系统',
    0, '', '王总', '13800000003', '广东 - 深圳', '2C01', 36, '平米',
    1000, 36000, '', 0, '[]', '数字渔业平台',
    36000, 36000, NULL, '蓝海广场', 'admin', '正常', datetime('now', '+8 hours')
  );

INSERT INTO Payments (
  id, project_id, order_id, amount, payment_time, payer_name, bank_name, remarks, source
) VALUES
  (1, 1, 1, 3000, '2026-03-21 10:00:00', '海渔集团', 'Demo Company', '定金', 'MANUAL'),
  (2, 1, 3, 36000, '2026-03-22 14:30:00', '蓝海广场', 'Demo Company', '全款', 'MANUAL');

PRAGMA foreign_keys = ON;
