-- 全局写接口限流表
CREATE TABLE IF NOT EXISTS WriteRateLimits (
  rate_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
