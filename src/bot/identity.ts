import type { TelegramApi } from "../lib/telegram";

/** bot 自己的 @username，进程内缓存一次（用于拼 t.me 深链）。 */
let cached: string | null | undefined;

export async function botUsername(tg: TelegramApi): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const me = await tg.getMe();
    cached = me.username ?? null;
  } catch {
    cached = null;
  }
  return cached;
}
