-- Purpose: Add production indexes for high-frequency order / payment / booth-map access paths
-- Scope: Production / remote D1 and any environment upgraded from earlier schema versions
-- Rollback: Drop the indexes listed in this file if rollback is required

CREATE INDEX IF NOT EXISTS idx_orders_project_status_created_at
ON Orders (project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_project_booth_status_created_at
ON Orders (project_id, booth_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_orders_project_sales_created_at
ON Orders (project_id, sales_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_order_deleted_time
ON Payments (order_id, deleted_at, payment_time DESC);

CREATE INDEX IF NOT EXISTS idx_payments_project_deleted_order
ON Payments (project_id, deleted_at, order_id);

CREATE INDEX IF NOT EXISTS idx_expenses_order_deleted_created_at
ON Expenses (order_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_project_deleted_order
ON Expenses (project_id, deleted_at, order_id);

CREATE INDEX IF NOT EXISTS idx_booths_project_hall_id
ON Booths (project_id, hall, id);

CREATE INDEX IF NOT EXISTS idx_booths_project_booth_map_id
ON Booths (project_id, booth_map_id, id);

CREATE INDEX IF NOT EXISTS idx_booth_maps_project_updated_at
ON BoothMaps (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booth_map_items_project_map_z_index
ON BoothMapItems (project_id, map_id, z_index, id);

CREATE INDEX IF NOT EXISTS idx_booth_map_items_project_map_booth_code
ON BoothMapItems (project_id, map_id, booth_code);
