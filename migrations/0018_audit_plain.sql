-- 审计日志回归「只追加的流水」：哈希链没有密钥，谁有库权限都能重算整条链，
-- 防不了改数据的人，却要在每次读页面时逐行重算 SHA-256，白白吃掉 CPU。
DROP TABLE IF EXISTS audit_chain;
ALTER TABLE audit_log DROP COLUMN prev_hash;
ALTER TABLE audit_log DROP COLUMN hash;
