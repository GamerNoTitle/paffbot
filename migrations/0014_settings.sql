-- 运行期配置：优先读这里，缺省再回退到 Worker 的 env / secret
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);
