-- 审计链校验检查点：只校验新增的行，避免每次打开审计页都重算整条链
CREATE TABLE IF NOT EXISTS audit_chain (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  through_id INTEGER NOT NULL,
  hash       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
