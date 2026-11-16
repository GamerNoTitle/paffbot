-- 黑名单：进过这个名单的人，申请直接 decline + ban，不建验证记录、不占配额、不通知。
-- 与 /ban 的区别：/ban 是「踢掉这个人」，黑名单是「以后都别想申请」。
CREATE TABLE IF NOT EXISTS blacklist (
  chat_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  username   TEXT,
  reason     TEXT,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_user ON blacklist(user_id);

-- groups.mode 从来没被读过（模式由 update 类型决定），删掉
ALTER TABLE groups DROP COLUMN mode;
