-- paffbot 初始 schema（D1 / SQLite 方言，同时保持对 TiDB 的迁移友好度）
-- 所有时间戳统一为 epoch 毫秒（INTEGER），避免时区问题。

-- webhook 幂等：Telegram 收不到 200 会重投，按 update_id 去重
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id   INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- 群配置（第一次见到某个群时自动登记）
CREATE TABLE IF NOT EXISTS groups (
  chat_id    INTEGER PRIMARY KEY,
  title      TEXT,
  mode       TEXT NOT NULL DEFAULT 'auto', -- auto | join_request | group_join
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 验证记录：一条记录 = 一次"某人想进某个群"的完整生命周期
CREATE TABLE IF NOT EXISTS verifications (
  id           TEXT PRIMARY KEY,
  chat_id      INTEGER NOT NULL,
  chat_title   TEXT,
  user_id      INTEGER NOT NULL,
  username     TEXT,
  display_name TEXT,
  status       TEXT NOT NULL,  -- pending | approved | declined | timeout | banned | blocked
  source       TEXT NOT NULL,  -- join_request | group_join | admin
  method       TEXT,           -- ssh | quiz | button | admin | timeout | profile
  reason       TEXT,
  detail       TEXT,           -- JSON：题目选择、尝试次数、证明摘要等
  operator_id  INTEGER,        -- 谁批准的；系统操作填 0
  update_id    INTEGER,        -- 触发它的 Telegram update
  nonce        TEXT NOT NULL,  -- 挑战串随机段
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  decided_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_verifications_pending ON verifications(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_verifications_user    ON verifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifications_chat    ON verifications(chat_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_verifications_update ON verifications(update_id) WHERE update_id IS NOT NULL;

-- 用户注册的 SSH 公钥（多用户多把钥匙）
CREATE TABLE IF NOT EXISTS ssh_keys (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  fingerprint  TEXT NOT NULL,
  key_type     TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE(user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON ssh_keys(user_id, created_at DESC);

-- 审计日志：append-only，带哈希链（prev_hash / hash），事后改库可被发现
CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  actor_id        INTEGER NOT NULL,
  actor_type      TEXT NOT NULL, -- super_admin | group_admin | system | user
  action          TEXT NOT NULL,
  chat_id         INTEGER,
  target_user_id  INTEGER,
  verification_id TEXT,
  detail          TEXT,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_chat   ON audit_log(chat_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_user_id, ts DESC);

-- Telegram 群管理员判定缓存（60s），避免每条命令都打一次 getChatMember
CREATE TABLE IF NOT EXISTS admin_cache (
  chat_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  is_admin   INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
