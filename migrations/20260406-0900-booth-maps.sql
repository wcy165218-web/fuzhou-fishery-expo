-- Purpose: Add booth map management, runtime view support, and booth display names
-- Scope: Production / preview D1 schema evolution
-- Rollback:
--   DROP TABLE BoothMapItems;
--   DROP TABLE BoothMaps;
--   Rebuild Booths / Orders if you need to remove added columns in SQLite.

CREATE TABLE IF NOT EXISTS BoothMaps (
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

CREATE TABLE IF NOT EXISTS BoothMapItems (
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

ALTER TABLE Booths ADD COLUMN width_m REAL NOT NULL DEFAULT 0;
ALTER TABLE Booths ADD COLUMN height_m REAL NOT NULL DEFAULT 0;
ALTER TABLE Booths ADD COLUMN opening_type TEXT;
ALTER TABLE Booths ADD COLUMN booth_map_id INTEGER;
ALTER TABLE Booths ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE Orders ADD COLUMN booth_display_name TEXT;
