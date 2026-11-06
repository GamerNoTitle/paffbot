-- 记住"这个人在这个群验证过"，退群重进不用重来
CREATE TABLE IF NOT EXISTS verified_members (
  chat_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_verified_members_user ON verified_members(user_id, verified_at DESC);
