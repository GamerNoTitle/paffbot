import { cacheAdmin, getCachedAdmin } from "../db";
import type { Config } from "../env";
import type { TelegramApi } from "../lib/telegram";

export interface AuthDeps {
  config: Config;
  db: D1Database;
  tg: TelegramApi;
}

export function isSuperAdmin(config: Config, userId: number): boolean {
  return config.adminIds.includes(userId);
}

/**
 * 群管理员 = Telegram 里真实具有 can_restrict_members 的人。
 * 不维护本地白名单，权限跟着群设置走，不会出现"群主撤了某人但 bot 还认"的情况。
 * 结果缓存 60 秒，避免每条命令都打一次 Telegram。
 */
export async function isGroupAdmin(deps: AuthDeps, chatId: number, userId: number): Promise<boolean> {
  if (isSuperAdmin(deps.config, userId)) return true;

  const cached = await getCachedAdmin(deps.db, chatId, userId);
  if (cached !== null) return cached;

  let isAdmin = false;
  try {
    const member = await deps.tg.getChatMember(chatId, userId);
    isAdmin =
      member.status === "creator" ||
      (member.status === "administrator" && member.can_restrict_members !== false);
  } catch (err) {
    // bot 不是管理员 / 群不存在 / 用户已离开，都按"不是管理员"处理
    console.warn(`[auth] getChatMember 失败 chat=${chatId} user=${userId}:`, err instanceof Error ? err.message : err);
    return false;
  }

  await cacheAdmin(deps.db, chatId, userId, isAdmin, 60_000);
  return isAdmin;
}
